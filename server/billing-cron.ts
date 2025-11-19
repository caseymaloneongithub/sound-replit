import cron from 'node-cron';
import Stripe from 'stripe';
import { db } from './db';
import { subscriptions, subscriptionItems, products, retailOrders, retailOrderItems, inventoryAdjustments } from '../shared/schema';
import { eq, and, lte, sql } from 'drizzle-orm';
import { sendPaymentFailureEmail, sendStaffPaymentFailureNotification } from './email';
import { normalizeToAllowedPickupDay } from '../shared/pickup-policy';

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' })
  : null;

const MAX_RETRY_ATTEMPTS = 3;
const CASE_PRICE_WITH_DISCOUNT = 54.00; // $60 - 10% subscription discount

/**
 * Idempotent function to finalize subscription charge by creating order
 * Can be called from both cron (synchronous) and webhooks (asynchronous)
 */
export async function finalizeSubscriptionCharge(paymentIntentId: string): Promise<boolean> {
  try {
    if (!stripe) {
      console.error('[BILLING] Stripe not configured');
      return false;
    }

    // Check if order already exists for this payment intent (idempotency)
    const existing = await db
      .select()
      .from(retailOrders)
      .where(eq(retailOrders.stripePaymentIntentId, paymentIntentId))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[BILLING] Order already exists for PaymentIntent ${paymentIntentId}, skipping`);
      return true;
    }

    // Get payment intent from Stripe with charges expanded
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge']
    });
    
    if (paymentIntent.status !== 'succeeded') {
      console.warn(`[BILLING] PaymentIntent ${paymentIntentId} status is ${paymentIntent.status}, cannot finalize`);
      return false;
    }

    // Check if payment has been refunded (critical safety check)
    const latestCharge = paymentIntent.latest_charge;
    const refundedAmount =
      latestCharge && typeof latestCharge === 'object' && 'amount_refunded' in latestCharge
        ? latestCharge.amount_refunded ?? 0
        : 0;
    const isRefunded =
      latestCharge && typeof latestCharge === 'object' && 'refunded' in latestCharge
        ? latestCharge.refunded === true || refundedAmount > 0
        : false;
    
    if (isRefunded) {
      console.error(`[BILLING] PaymentIntent ${paymentIntentId} has been refunded (${refundedAmount}/${paymentIntent.amount}), cannot finalize`);
      return false;
    }

    const subscriptionId = paymentIntent.metadata.subscriptionId;
    if (!subscriptionId) {
      console.error(`[BILLING] No subscriptionId in PaymentIntent ${paymentIntentId} metadata`);
      return false;
    }

    // Get subscription and items
    const subscription = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
      .limit(1);

    if (subscription.length === 0) {
      console.error(`[BILLING] Subscription ${subscriptionId} not found`);
      return false;
    }

    const sub = subscription[0];

    // Check if this PaymentIntent was already refunded by us (prevent Stripe retry duplicates)
    if (sub.lastPaymentIntentId === paymentIntentId && sub.lastRefundedAt) {
      const paymentIntentCreatedMs = paymentIntent.created * 1000;
      const lastRefundedMs = new Date(sub.lastRefundedAt).valueOf();
      
      // If PaymentIntent was created before we refunded it, skip processing
      if (paymentIntentCreatedMs <= lastRefundedMs) {
        console.warn(`[BILLING] PaymentIntent ${paymentIntentId} was already refunded on ${sub.lastRefundedAt}, skipping`);
        return false;
      }
    }

    const items = await db
      .select({
        id: subscriptionItems.id,
        subscriptionId: subscriptionItems.subscriptionId,
        productId: subscriptionItems.productId,
        quantity: subscriptionItems.quantity,
        product: products,
      })
      .from(subscriptionItems)
      .leftJoin(products, eq(subscriptionItems.productId, products.id))
      .where(eq(subscriptionItems.subscriptionId, sub.id));

    // Extract tax information from PaymentIntent metadata, or calculate from amount charged
    let subtotal: number;
    let taxAmount: number;
    let totalAmount: number;
    
    if (paymentIntent.metadata.subtotal && paymentIntent.metadata.taxAmount && paymentIntent.metadata.totalAmount) {
      // Use metadata if available
      subtotal = parseFloat(paymentIntent.metadata.subtotal);
      taxAmount = parseFloat(paymentIntent.metadata.taxAmount);
      totalAmount = parseFloat(paymentIntent.metadata.totalAmount);
    } else {
      // Metadata missing - derive from actual charge amount to maintain data integrity
      // The customer was charged paymentIntent.amount, which includes tax
      const amountCharged = paymentIntent.amount / 100; // Convert cents to dollars
      const TAX_RATE = 0.1035; // 10.35%
      
      // Work backwards: totalAmount = subtotal * (1 + TAX_RATE)
      // Therefore: subtotal = totalAmount / (1 + TAX_RATE)
      subtotal = amountCharged / (1 + TAX_RATE);
      taxAmount = amountCharged - subtotal;
      totalAmount = amountCharged;
      
      console.warn(`[BILLING] PaymentIntent ${paymentIntentId} missing tax metadata, derived from charge amount: subtotal=$${subtotal.toFixed(2)}, tax=$${taxAmount.toFixed(2)}, total=$${totalAmount.toFixed(2)}`);
    }

    try {
      // Create order in transaction
      await db.transaction(async (tx) => {
        // Generate order number
        const orderCount = await tx.select({ count: sql<number>`count(*)` }).from(retailOrders);
        const orderNumber = `RO-${String((orderCount[0].count as number) + 1).padStart(6, '0')}`;

        // Create retail order
        const [newOrder] = await tx.insert(retailOrders).values({
          orderNumber,
          customerName: sub.customerName,
          customerEmail: sub.customerEmail,
          customerPhone: sub.customerPhone,
          status: 'pending',
          subtotal: subtotal.toFixed(2),
          taxAmount: taxAmount.toFixed(2),
          totalAmount: totalAmount.toFixed(2),
          stripePaymentIntentId: paymentIntentId,
          isSubscriptionOrder: true,
          userId: sub.userId,
        }).returning();

        // Create order items and deduct inventory
        for (const item of items) {
          await tx.insert(retailOrderItems).values({
            orderId: newOrder.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: CASE_PRICE_WITH_DISCOUNT.toFixed(2),
          });

          // Lock product row and deduct inventory
          const [product] = await tx
            .select()
            .from(products)
            .where(eq(products.id, item.productId))
            .for('update');

          if (!product) {
            throw new Error(`Product ${item.productId} not found`);
          }

          const newStock = product.stockQuantity - item.quantity;
          await tx
            .update(products)
            .set({ stockQuantity: newStock })
            .where(eq(products.id, item.productId));

          // Record inventory adjustment
          await tx.insert(inventoryAdjustments).values({
            productId: item.productId,
            reason: 'fulfillment',
            quantity: -item.quantity,
            notes: `Auto-deducted for subscription order ${orderNumber}`,
            orderId: newOrder.id,
            orderType: 'retail',
          });
        }

        // Update subscription - calculate next charge date
        const daysUntilNext = 
          sub.subscriptionFrequency === 'weekly' ? 7 :
          sub.subscriptionFrequency === 'bi-weekly' ? 14 :
          28;

        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + daysUntilNext);

        // Lock subscription and update
        await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, sub.id))
          .for('update');

        // Normalize next date to allowed pickup day (Mon-Thu)
        const normalizedNextDate = normalizeToAllowedPickupDay(nextDate);
        
        await tx
          .update(subscriptions)
          .set({
            nextChargeAt: normalizedNextDate,
            nextDeliveryDate: normalizedNextDate,
            billingStatus: 'active',
            retryCount: 0,
            lastPaymentIntentId: paymentIntentId,
            lastRefundedAt: null, // Clear refund marker on successful fulfillment
            processingLock: false,
          })
          .where(eq(subscriptions.id, sub.id));

        console.log(`[BILLING] ✅ Finalized charge for subscription ${sub.id} - Order ${orderNumber} created`);
      });

      return true;
    } catch (orderError: any) {
      // COMPENSATING ROLLBACK: Refund the payment if order creation fails
      console.error(`[BILLING] Order creation failed after successful payment, initiating refund:`, orderError.message);
      
      try {
        const refund = await stripe!.refunds.create({
          payment_intent: paymentIntentId,
          reason: 'requested_by_customer',
          metadata: {
            reason: 'order_creation_failed',
            subscriptionId: sub.id,
            error: orderError.message,
          },
        });

        // Schedule retry for tomorrow (compensating rollback recovery)
        const nextRetry = new Date();
        nextRetry.setDate(nextRetry.getDate() + 1);

        // Update subscription with refund info and schedule retry
        const newRetryCount = Math.min((sub.retryCount || 0) + 1, MAX_RETRY_ATTEMPTS);
        
        await db
          .update(subscriptions)
          .set({
            lastRefundId: refund.id,
            lastRefundedAt: new Date(),
            billingStatus: 'active', // Keep active so cron can retry
            nextChargeAt: nextRetry,
            retryCount: newRetryCount,
            processingLock: false,
          })
          .where(eq(subscriptions.id, sub.id));

        console.error(`[BILLING] ⚠️ Refund ${refund.id} created for failed order - Manual review required`);
        
        return false;
      } catch (refundError: any) {
        console.error(`[BILLING] 🚨 CRITICAL: Failed to refund payment ${paymentIntentId}:`, refundError.message);
        console.error(`[BILLING] 🚨 Manual intervention required for subscription ${sub.id}`);
        
        return false;
      }
    }
  } catch (error: any) {
    console.error(`[BILLING] Error in finalizeSubscriptionCharge:`, error.message);
    return false;
  }
}

async function processSubscriptionBilling(subscription: any, items: any[]) {
  if (!stripe) {
    console.error('[BILLING] Stripe not configured');
    return false;
  }

  // Calculate subtotal amount
  const subtotal = items.reduce((sum, item) => sum + (CASE_PRICE_WITH_DISCOUNT * item.quantity), 0);
  
  // Calculate sales tax (WA State 6.5% + Seattle City 3.85% = 10.35%)
  const TAX_RATE = 0.1035;
  const taxAmount = subtotal * TAX_RATE;
  const totalAmount = subtotal + taxAmount;
  
  // Convert to cents and round
  const subtotalCents = Math.round(subtotal * 100);
  const taxCents = Math.round(taxAmount * 100);
  const amountInCents = Math.round(totalAmount * 100);

  try {
    // Create PaymentIntent with stored payment method
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      customer: subscription.stripeCustomerId,
      payment_method: subscription.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        subscriptionId: subscription.id,
        type: 'subscription_renewal',
        subtotal: (subtotalCents / 100).toFixed(2),
        taxRate: TAX_RATE.toString(),
        taxAmount: (taxCents / 100).toFixed(2),
        totalAmount: (amountInCents / 100).toFixed(2),
      },
    });

    // Handle different payment states
    if (paymentIntent.status === 'succeeded') {
      // Payment successful - finalize immediately
      return await finalizeSubscriptionCharge(paymentIntent.id);
    } else if (paymentIntent.status === 'requires_action') {
      // Customer needs to complete 3D Secure authentication
      console.log(`[BILLING] Payment requires authentication for subscription ${subscription.id}`);
      
      await db
        .update(subscriptions)
        .set({
          billingStatus: 'awaiting_auth',
          lastPaymentIntentId: paymentIntent.id,
          processingLock: false,
        })
        .where(eq(subscriptions.id, subscription.id));

      // TODO: Send customer email with link to complete authentication
      console.warn(`[BILLING] ⚠️ Customer authentication required for subscription ${subscription.id} - PaymentIntent ${paymentIntent.id}`);
      
      return false; // Don't increment retry count
    } else if (paymentIntent.status === 'processing') {
      // Payment is being processed asynchronously
      console.log(`[BILLING] Payment processing asynchronously for subscription ${subscription.id}`);
      
      await db
        .update(subscriptions)
        .set({
          billingStatus: 'awaiting_confirmation',
          lastPaymentIntentId: paymentIntent.id,
          processingLock: false,
        })
        .where(eq(subscriptions.id, subscription.id));

      // Webhook will finalize when processing completes
      return false; // Don't increment retry count
    } else {
      // Other statuses (requires_payment_method, canceled, etc.)
      console.warn(`[BILLING] Payment intent ${paymentIntent.id} status: ${paymentIntent.status}`);
      
      // Update subscription with payment attempt
      await db
        .update(subscriptions)
        .set({
          lastPaymentIntentId: paymentIntent.id,
          processingLock: false,
        })
        .where(eq(subscriptions.id, subscription.id));
      
      return false;
    }
  } catch (error: any) {
    console.error(`[BILLING] Failed to charge subscription ${subscription.id}:`, error.message);

    // Send email notifications on payment failure
    const itemsList = items.map(item => ({
      productName: item.product?.name || 'Unknown Product',
      quantity: item.quantity,
    }));

    try {
      await Promise.all([
        sendPaymentFailureEmail({
          customerEmail: subscription.customerEmail,
          customerName: subscription.customerName,
          subscriptionItems: itemsList,
          amount: totalAmount,
          errorMessage: error.message,
        }),
        sendStaffPaymentFailureNotification({
          customerEmail: subscription.customerEmail,
          customerName: subscription.customerName,
          subscriptionItems: itemsList,
          amount: totalAmount,
          errorMessage: error.message,
        }),
      ]);
    } catch (emailError) {
      console.error('[BILLING] Failed to send payment failure emails:', emailError);
    }

    // Update retry count
    const newRetryCount = subscription.retryCount + 1;
    await db
      .update(subscriptions)
      .set({
        retryCount: newRetryCount,
        billingStatus: newRetryCount >= MAX_RETRY_ATTEMPTS ? 'retrying' : 'active',
        lastPaymentIntentId: error.payment_intent?.id || null,
        processingLock: false,
        // If max retries reached, pause the subscription
        status: newRetryCount >= MAX_RETRY_ATTEMPTS ? 'paused' : subscription.status,
      })
      .where(eq(subscriptions.id, subscription.id));

    if (newRetryCount >= MAX_RETRY_ATTEMPTS) {
      console.error(`[BILLING] Subscription ${subscription.id} paused after ${MAX_RETRY_ATTEMPTS} failed attempts`);
    }

    return false;
  }
}

export async function runDailyBilling() {
  console.log('[BILLING] Starting daily billing process...');

  try {
    const now = new Date();

    // Find all locally-managed subscriptions that are due for billing
    // IMPORTANT: Only select subscriptions with billingStatus='active' to avoid
    // creating duplicate PaymentIntents for subscriptions in awaiting states
    const dueSubscriptions = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.billingType, 'local_managed'),
          eq(subscriptions.status, 'active'),
          eq(subscriptions.billingStatus, 'active'),
          lte(subscriptions.nextChargeAt, now),
          eq(subscriptions.processingLock, false)
        )
      );

    console.log(`[BILLING] Found ${dueSubscriptions.length} subscriptions due for billing`);

    if (dueSubscriptions.length === 0) {
      console.log('[BILLING] No subscriptions to process');
      return;
    }

    // Process each subscription with atomic lock acquisition
    for (const subscription of dueSubscriptions) {
      try {
        // Atomically acquire lock using conditional update
        const lockResult = await db
          .update(subscriptions)
          .set({ processingLock: true })
          .where(
            and(
              eq(subscriptions.id, subscription.id),
              eq(subscriptions.processingLock, false), // Only update if not already locked
              eq(subscriptions.status, 'active'),
              eq(subscriptions.billingStatus, 'active'), // Only process if billing status is active
              lte(subscriptions.nextChargeAt, now)
            )
          )
          .returning({ id: subscriptions.id });

        if (lockResult.length === 0) {
          // Another process already acquired the lock, skip
          console.log(`[BILLING] Subscription ${subscription.id} already being processed, skipping`);
          continue;
        }

        // Get subscription items
        const items = await db
          .select({
            id: subscriptionItems.id,
            subscriptionId: subscriptionItems.subscriptionId,
            productId: subscriptionItems.productId,
            quantity: subscriptionItems.quantity,
            product: products,
          })
          .from(subscriptionItems)
          .leftJoin(products, eq(subscriptionItems.productId, products.id))
          .where(eq(subscriptionItems.subscriptionId, subscription.id));

        if (items.length === 0) {
          console.warn(`[BILLING] Subscription ${subscription.id} has no items, skipping`);
          await db
            .update(subscriptions)
            .set({ processingLock: false })
            .where(eq(subscriptions.id, subscription.id));
          continue;
        }

        // Process the billing
        await processSubscriptionBilling(subscription, items);
      } catch (error) {
        console.error(`[BILLING] Error processing subscription ${subscription.id}:`, error);
        // Release lock on error
        await db
          .update(subscriptions)
          .set({ processingLock: false })
          .where(eq(subscriptions.id, subscription.id));
      }
    }

    console.log('[BILLING] Daily billing process completed');
  } catch (error) {
    console.error('[BILLING] Fatal error in daily billing process:', error);
  }
}

/**
 * Check for stale awaiting states and attempt recovery
 * Runs hourly to detect subscriptions stuck in awaiting_auth or awaiting_confirmation
 */
async function checkStaleAwaitingStates() {
  if (!stripe) {
    console.error('[STALE_CHECK] Stripe not configured');
    return;
  }

  console.log('[STALE_CHECK] Checking for stale awaiting states...');

  try {
    const now = new Date();
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // Find subscriptions in awaiting_auth (older than 15 minutes)
    const staleAuth = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.billingType, 'local_managed'),
          eq(subscriptions.billingStatus, 'awaiting_auth'),
          lte(subscriptions.nextChargeAt, fifteenMinutesAgo)
        )
      );

    // Find subscriptions in awaiting_confirmation (older than 2 hours)
    const staleConfirmation = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.billingType, 'local_managed'),
          eq(subscriptions.billingStatus, 'awaiting_confirmation'),
          lte(subscriptions.nextChargeAt, twoHoursAgo)
        )
      );

    console.log(`[STALE_CHECK] Found ${staleAuth.length} stale auth and ${staleConfirmation.length} stale confirmation states`);

    // Process stale auth subscriptions
    for (const sub of staleAuth) {
      try {
        console.log(`[STALE_CHECK] Processing stale auth for subscription ${sub.id}`);

        // Check PaymentIntent status with Stripe
        if (sub.lastPaymentIntentId) {
          const paymentIntent = await stripe.paymentIntents.retrieve(sub.lastPaymentIntentId);
          
          if (paymentIntent.status === 'succeeded') {
            // Payment succeeded but webhook was missed - finalize now
            console.log(`[STALE_CHECK] Payment succeeded, finalizing now`);
            await finalizeSubscriptionCharge(sub.lastPaymentIntentId);
            continue;
          } else if (paymentIntent.status === 'requires_action') {
            // Still waiting for customer action - notify and extend deadline
            console.log(`[STALE_CHECK] Still waiting for customer action, sending reminder`);
            await sendPaymentFailureEmail({
              customerEmail: sub.customerEmail,
              customerName: sub.customerName,
              subscriptionItems: [],
              amount: 0,
              errorMessage: 'Your payment requires additional authentication. Please check your email or bank app to complete the payment.'
            });
          }
        }

        // Schedule retry for next business day
        const nextRetry = new Date();
        nextRetry.setDate(nextRetry.getDate() + 1);

        await db
          .update(subscriptions)
          .set({
            billingStatus: 'active', // Reset to active for retry
            nextChargeAt: nextRetry,
            retryCount: Math.min((sub.retryCount || 0) + 1, MAX_RETRY_ATTEMPTS),
            processingLock: false,
          })
          .where(eq(subscriptions.id, sub.id));

      } catch (error: any) {
        console.error(`[STALE_CHECK] Error processing stale auth ${sub.id}:`, error.message);
      }
    }

    // Process stale confirmation subscriptions
    for (const sub of staleConfirmation) {
      try {
        console.log(`[STALE_CHECK] Processing stale confirmation for subscription ${sub.id}`);

        // Check PaymentIntent status with Stripe
        if (sub.lastPaymentIntentId) {
          const paymentIntent = await stripe.paymentIntents.retrieve(sub.lastPaymentIntentId);
          
          if (paymentIntent.status === 'succeeded') {
            // Payment succeeded but webhook was missed - finalize now
            console.log(`[STALE_CHECK] Payment succeeded, finalizing now`);
            await finalizeSubscriptionCharge(sub.lastPaymentIntentId);
            continue;
          } else if (paymentIntent.status === 'processing') {
            // Still processing - notify staff
            console.log(`[STALE_CHECK] Still processing after 2 hours, notifying staff`);
            await sendStaffPaymentFailureNotification({
              customerEmail: sub.customerEmail,
              customerName: sub.customerName,
              subscriptionItems: [],
              amount: 0,
              errorMessage: `Payment for subscription ${sub.id} has been processing for over 2 hours. Manual review required.`
            });
          } else if (paymentIntent.status === 'requires_payment_method') {
            // Payment failed - schedule retry
            console.log(`[STALE_CHECK] Payment failed, scheduling retry`);
            const nextRetry = new Date();
            nextRetry.setDate(nextRetry.getDate() + 1);

            await db
              .update(subscriptions)
              .set({
                billingStatus: 'active',
                nextChargeAt: nextRetry,
                retryCount: Math.min((sub.retryCount || 0) + 1, MAX_RETRY_ATTEMPTS),
                processingLock: false,
              })
              .where(eq(subscriptions.id, sub.id));

            await sendPaymentFailureEmail({
              customerEmail: sub.customerEmail,
              customerName: sub.customerName,
              subscriptionItems: [],
              amount: 0,
              errorMessage: 'Your subscription payment could not be processed. We will retry tomorrow.'
            });
          }
        }
      } catch (error: any) {
        console.error(`[STALE_CHECK] Error processing stale confirmation ${sub.id}:`, error.message);
      }
    }

    console.log('[STALE_CHECK] Stale state check completed');
  } catch (error: any) {
    console.error('[STALE_CHECK] Fatal error in stale state check:', error.message);
  }
}

// Schedule daily billing at 4:00 AM Pacific Time
// Using cron: '0 4 * * *' runs at 4:00 AM server time
export function startBillingCron() {
  console.log('[BILLING] Scheduling daily billing cron job for 4:00 AM');
  
  // Run at 4:00 AM every day
  cron.schedule('0 4 * * *', async () => {
    console.log('[BILLING] Cron triggered at 4:00 AM');
    await runDailyBilling();
  });

  // Run stale state check every hour
  cron.schedule('0 * * * *', async () => {
    console.log('[STALE_CHECK] Hourly stale state check triggered');
    await checkStaleAwaitingStates();
  });

  // Also run on startup to catch any missed billings
  setTimeout(async () => {
    console.log('[BILLING] Running initial billing check on startup');
    await runDailyBilling();
  }, 5000); // 5 second delay to let server fully initialize
}
