import cron from 'node-cron';
import Stripe from 'stripe';
import { db } from './db';
import { retailOrders, retailOrderItemsV2, retailSubscriptions, retailSubscriptionItems, retailProducts, flavors } from '../shared/schema';
import { eq, and, lte, sql, gte, lt } from 'drizzle-orm';
import { normalizeToAllowedPickupDay, getBillingDateForPickup } from '../shared/pickup-policy';
import { sendBillingReminderEmail } from './email';
import { addDays, startOfDay, endOfDay } from 'date-fns';

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' })
  : null;

const MAX_RETRY_ATTEMPTS = 3;

/**
 * Finalize retail subscription charge by creating order
 * Can be called from both cron (synchronous) and webhooks (asynchronous)
 */
export async function finalizeRetailSubscriptionCharge(paymentIntentId: string): Promise<boolean> {
  try {
    if (!stripe) {
      console.error('[BILLING] Stripe not configured');
      return false;
    }

    // Check if order already exists (idempotency)
    const existing = await db
      .select()
      .from(retailOrders)
      .where(eq(retailOrders.stripePaymentIntentId, paymentIntentId))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[BILLING] Order already exists for PaymentIntent ${paymentIntentId}, skipping`);
      return true;
    }

    // Get payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge']
    });
    
    if (paymentIntent.status !== 'succeeded') {
      console.warn(`[BILLING] PaymentIntent ${paymentIntentId} status is ${paymentIntent.status}, cannot finalize`);
      return false;
    }

    const retailSubscriptionId = paymentIntent.metadata.retailSubscriptionId;
    if (!retailSubscriptionId) {
      console.error(`[BILLING] No retailSubscriptionId in PaymentIntent ${paymentIntentId} metadata`);
      return false;
    }

    // Get retail subscription
    const [sub] = await db
      .select()
      .from(retailSubscriptions)
      .where(eq(retailSubscriptions.id, retailSubscriptionId));

    if (!sub) {
      console.error(`[BILLING] Retail subscription ${retailSubscriptionId} not found`);
      return false;
    }

    // Get subscription items with product and flavor info
    const items = await db
      .select({
        id: retailSubscriptionItems.id,
        subscriptionId: retailSubscriptionItems.subscriptionId,
        retailProductId: retailSubscriptionItems.retailProductId,
        selectedFlavorId: retailSubscriptionItems.selectedFlavorId,
        quantity: retailSubscriptionItems.quantity,
        retailProduct: retailProducts,
      })
      .from(retailSubscriptionItems)
      .leftJoin(retailProducts, eq(retailSubscriptionItems.retailProductId, retailProducts.id))
      .where(eq(retailSubscriptionItems.subscriptionId, sub.id));

    // Extract payment amounts from metadata
    const subtotal = parseFloat(paymentIntent.metadata.subtotal || '0');
    const taxAmount = parseFloat(paymentIntent.metadata.taxAmount || '0');
    const totalAmount = parseFloat(paymentIntent.metadata.totalAmount || '0');

    // Create order
    const orderCount = await db.select({ count: sql<number>`count(*)` }).from(retailOrders);
    const orderNumber = `RO-${String((orderCount[0].count as number) + 1).padStart(6, '0')}`;

    const [newOrder] = await db.insert(retailOrders).values({
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

    // Create order items
    for (const item of items) {
      if (!item.retailProduct) continue;
      
      const basePrice = parseFloat(item.retailProduct.price);
      const discount = item.retailProduct.subscriptionDiscount ? Number(item.retailProduct.subscriptionDiscount) : 0;
      const unitPrice = basePrice * (1 - discount / 100);

      await db.insert(retailOrderItemsV2).values({
        orderId: newOrder.id,
        retailProductId: item.retailProductId,
        selectedFlavorId: item.selectedFlavorId,
        quantity: item.quantity,
        unitPrice: unitPrice.toFixed(2),
      });
    }

    // Update subscription - calculate next charge date
    const daysUntilNext = 
      sub.subscriptionFrequency === 'weekly' ? 7 :
      sub.subscriptionFrequency === 'bi-weekly' ? 14 :
      28;

    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + daysUntilNext);
    const normalizedNextPickupDate = normalizeToAllowedPickupDay(nextDate);
    // Billing happens on Monday of the pickup week
    const nextBillingDate = getBillingDateForPickup(normalizedNextPickupDate);
    
    await db
      .update(retailSubscriptions)
      .set({
        nextChargeAt: nextBillingDate,
        nextDeliveryDate: normalizedNextPickupDate,
        billingStatus: 'active',
        retryCount: 0,
        lastPaymentIntentId: paymentIntentId,
        lastRefundedAt: null,
        processingLock: false,
      })
      .where(eq(retailSubscriptions.id, sub.id));

    console.log(`[BILLING] ✅ Finalized retail subscription charge ${sub.id} - Order ${orderNumber} created`);
    return true;
  } catch (error: any) {
    console.error(`[BILLING] Error in finalizeRetailSubscriptionCharge:`, error.message);
    return false;
  }
}

/**
 * Process retail subscription billing
 */
async function processRetailSubscriptionBilling(subscription: any, items: any[]) {
  if (!stripe) {
    console.error('[BILLING] Stripe not configured');
    return false;
  }

  // Calculate amounts from retail products
  const TAX_RATE = 0.1035;
  let subtotal = 0;
  
  for (const item of items) {
    if (!item.retailProduct) continue;
    const basePrice = parseFloat(item.retailProduct.price);
    const discount = item.retailProduct.subscriptionDiscount ? Number(item.retailProduct.subscriptionDiscount) : 0;
    const unitPrice = basePrice * (1 - discount / 100);
    subtotal += unitPrice * item.quantity;
  }

  const taxAmount = subtotal * TAX_RATE;
  const totalAmount = subtotal + taxAmount;
  
  const amountInCents = Math.round(totalAmount * 100);

  try {
    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      customer: subscription.stripeCustomerId,
      payment_method: subscription.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        retailSubscriptionId: subscription.id,
        type: 'retail_subscription_renewal',
        subtotal: subtotal.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
      },
    });

    // Handle payment states
    if (paymentIntent.status === 'succeeded') {
      return await finalizeRetailSubscriptionCharge(paymentIntent.id);
    } else if (paymentIntent.status === 'requires_action') {
      await db
        .update(retailSubscriptions)
        .set({
          billingStatus: 'awaiting_auth',
          lastPaymentIntentId: paymentIntent.id,
          processingLock: false,
        })
        .where(eq(retailSubscriptions.id, subscription.id));

      console.warn(`[BILLING] ⚠️ Customer authentication required for retail subscription ${subscription.id}`);
      return false;
    } else if (paymentIntent.status === 'processing') {
      await db
        .update(retailSubscriptions)
        .set({
          billingStatus: 'awaiting_confirmation',
          lastPaymentIntentId: paymentIntent.id,
          processingLock: false,
        })
        .where(eq(retailSubscriptions.id, subscription.id));

      return false;
    } else {
      await db
        .update(retailSubscriptions)
        .set({
          lastPaymentIntentId: paymentIntent.id,
          processingLock: false,
        })
        .where(eq(retailSubscriptions.id, subscription.id));
      
      return false;
    }
  } catch (error: any) {
    console.error(`[BILLING] Failed to charge retail subscription ${subscription.id}:`, error.message);

    // Update retry count
    const newRetryCount = subscription.retryCount + 1;
    await db
      .update(retailSubscriptions)
      .set({
        retryCount: newRetryCount,
        billingStatus: newRetryCount >= MAX_RETRY_ATTEMPTS ? 'retrying' : 'active',
        lastPaymentIntentId: error.payment_intent?.id || null,
        processingLock: false,
        status: newRetryCount >= MAX_RETRY_ATTEMPTS ? 'paused' : subscription.status,
      })
      .where(eq(retailSubscriptions.id, subscription.id));

    if (newRetryCount >= MAX_RETRY_ATTEMPTS) {
      console.error(`[BILLING] Retail subscription ${subscription.id} paused after ${MAX_RETRY_ATTEMPTS} failed attempts`);
    }

    return false;
  }
}

export async function runDailyBilling() {
  console.log('[BILLING] Starting daily billing process...');

  try {
    const now = new Date();

    // Find all retail subscriptions that are due for billing
    const dueRetailSubscriptions = await db
      .select()
      .from(retailSubscriptions)
      .where(
        and(
          eq(retailSubscriptions.billingType, 'local_managed'),
          eq(retailSubscriptions.status, 'active'),
          eq(retailSubscriptions.billingStatus, 'active'),
          lte(retailSubscriptions.nextChargeAt, now),
          eq(retailSubscriptions.processingLock, false)
        )
      );

    console.log(`[BILLING] Found ${dueRetailSubscriptions.length} subscriptions due for billing`);

    if (dueRetailSubscriptions.length === 0) {
      console.log('[BILLING] No subscriptions to process');
      return;
    }

    // Process each retail subscription
    for (const subscription of dueRetailSubscriptions) {
      try {
        // Atomically acquire lock
        const lockResult = await db
          .update(retailSubscriptions)
          .set({ processingLock: true })
          .where(
            and(
              eq(retailSubscriptions.id, subscription.id),
              eq(retailSubscriptions.processingLock, false),
              eq(retailSubscriptions.status, 'active'),
              eq(retailSubscriptions.billingStatus, 'active'),
              lte(retailSubscriptions.nextChargeAt, now)
            )
          )
          .returning({ id: retailSubscriptions.id });

        if (lockResult.length === 0) {
          console.log(`[BILLING] Retail subscription ${subscription.id} already being processed, skipping`);
          continue;
        }

        // Get subscription items with retail products
        const items = await db
          .select({
            id: retailSubscriptionItems.id,
            subscriptionId: retailSubscriptionItems.subscriptionId,
            retailProductId: retailSubscriptionItems.retailProductId,
            selectedFlavorId: retailSubscriptionItems.selectedFlavorId,
            quantity: retailSubscriptionItems.quantity,
            retailProduct: retailProducts,
          })
          .from(retailSubscriptionItems)
          .leftJoin(retailProducts, eq(retailSubscriptionItems.retailProductId, retailProducts.id))
          .where(eq(retailSubscriptionItems.subscriptionId, subscription.id));

        if (items.length === 0) {
          console.warn(`[BILLING] Retail subscription ${subscription.id} has no items, skipping`);
          await db
            .update(retailSubscriptions)
            .set({ processingLock: false })
            .where(eq(retailSubscriptions.id, subscription.id));
          continue;
        }

        // Process the billing
        await processRetailSubscriptionBilling(subscription, items);
      } catch (error) {
        console.error(`[BILLING] Error processing retail subscription ${subscription.id}:`, error);
        // Release lock on error
        await db
          .update(retailSubscriptions)
          .set({ processingLock: false })
          .where(eq(retailSubscriptions.id, subscription.id));
      }
    }

    console.log('[BILLING] Daily billing process completed');
  } catch (error) {
    console.error('[BILLING] Fatal error in daily billing process:', error);
  }
}

/**
 * Send billing reminder emails to subscribers whose billing is due in 2 days
 * Uses UTC timestamps consistently via millisecond arithmetic to avoid timezone issues
 */
export async function sendBillingReminders() {
  console.log('[BILLING REMINDERS] Checking for subscriptions due in ~2 days...');

  try {
    const nowMs = Date.now();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    
    // Use millisecond arithmetic to avoid any timezone drift from date-fns
    // Subscriptions due between 48 and 72 hours from now (in UTC)
    const reminderWindowStart = new Date(nowMs + (2 * MS_PER_DAY)); // 48 hours from now
    const reminderWindowEnd = new Date(nowMs + (3 * MS_PER_DAY));   // 72 hours from now

    // Find active subscriptions that:
    // - Are locally managed
    // - Are active status
    // - Have active billing status  
    // - Are NOT locked for processing
    // - Have nextChargeAt within our reminder window
    const upcomingSubscriptions = await db
      .select()
      .from(retailSubscriptions)
      .where(
        and(
          eq(retailSubscriptions.billingType, 'local_managed'),
          eq(retailSubscriptions.status, 'active'),
          eq(retailSubscriptions.billingStatus, 'active'),
          eq(retailSubscriptions.processingLock, false),
          gte(retailSubscriptions.nextChargeAt, reminderWindowStart),
          lt(retailSubscriptions.nextChargeAt, reminderWindowEnd)
        )
      );

    console.log(`[BILLING REMINDERS] Found ${upcomingSubscriptions.length} subscriptions due in 2 days`);

    if (upcomingSubscriptions.length === 0) {
      console.log('[BILLING REMINDERS] No reminders to send');
      return;
    }

    const TAX_RATE = 0.1035;

    // Basic email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (const subscription of upcomingSubscriptions) {
      try {
        // Validate customer email exists and is valid
        if (!subscription.customerEmail || typeof subscription.customerEmail !== 'string') {
          console.warn(`[BILLING REMINDERS] Subscription ${subscription.id} has no customer email, skipping`);
          continue;
        }
        
        if (!emailRegex.test(subscription.customerEmail)) {
          console.warn(`[BILLING REMINDERS] Subscription ${subscription.id} has invalid email format: ${subscription.customerEmail}, skipping`);
          continue;
        }

        // Get subscription items with product and flavor info
        const items = await db
          .select({
            id: retailSubscriptionItems.id,
            quantity: retailSubscriptionItems.quantity,
            selectedFlavorId: retailSubscriptionItems.selectedFlavorId,
            retailProduct: retailProducts,
          })
          .from(retailSubscriptionItems)
          .leftJoin(retailProducts, eq(retailSubscriptionItems.retailProductId, retailProducts.id))
          .where(eq(retailSubscriptionItems.subscriptionId, subscription.id));

        if (items.length === 0) {
          console.warn(`[BILLING REMINDERS] Subscription ${subscription.id} has no items, skipping`);
          continue;
        }

        // Calculate estimated total
        let subtotal = 0;
        const subscriptionItems: Array<{ productName: string; quantity: number; price: string }> = [];

        for (const item of items) {
          if (!item.retailProduct) continue;
          
          const basePrice = parseFloat(item.retailProduct.price);
          const discount = item.retailProduct.subscriptionDiscount ? Number(item.retailProduct.subscriptionDiscount) : 0;
          const unitPrice = basePrice * (1 - discount / 100);
          const lineTotal = unitPrice * item.quantity;
          subtotal += lineTotal;

          // Get flavor name if it's a multi-flavor product
          let productName = item.retailProduct.productName || item.retailProduct.unitType;
          if (item.selectedFlavorId) {
            const [flavor] = await db
              .select()
              .from(flavors)
              .where(eq(flavors.id, item.selectedFlavorId));
            if (flavor) {
              productName = `${item.retailProduct.productName || item.retailProduct.unitType} - ${flavor.name}`;
            }
          }

          subscriptionItems.push({
            productName,
            quantity: item.quantity,
            price: `$${unitPrice.toFixed(2)}`
          });
        }

        const taxAmount = subtotal * TAX_RATE;
        const estimatedTotal = subtotal + taxAmount;

        // Send the reminder email
        await sendBillingReminderEmail({
          customerEmail: subscription.customerEmail,
          customerName: subscription.customerName,
          billingDate: subscription.nextChargeAt!,
          subscriptionItems,
          estimatedTotal
        });

        console.log(`[BILLING REMINDERS] ✅ Sent reminder to ${subscription.customerEmail}`);
      } catch (error) {
        console.error(`[BILLING REMINDERS] Error sending reminder for subscription ${subscription.id}:`, error);
        // Continue with other subscriptions even if one fails
      }
    }

    console.log('[BILLING REMINDERS] Finished sending reminders');
  } catch (error) {
    console.error('[BILLING REMINDERS] Fatal error:', error);
  }
}

// Schedule daily billing at 4:00 AM Pacific Time
export function startBillingCron() {
  console.log('[BILLING] Scheduling daily billing cron job for 4:00 AM');
  console.log('[BILLING] Scheduling billing reminder cron job for 9:00 AM');
  
  // Run billing at 4:00 AM every day
  cron.schedule('0 4 * * *', async () => {
    console.log('[BILLING] Cron triggered at 4:00 AM');
    await runDailyBilling();
  });

  // Run billing reminders at 9:00 AM every day (2 days before billing)
  cron.schedule('0 9 * * *', async () => {
    console.log('[BILLING REMINDERS] Cron triggered at 9:00 AM');
    await sendBillingReminders();
  });

  // Also run on startup to catch any missed billings
  setTimeout(async () => {
    console.log('[BILLING] Running initial billing check on startup');
    await runDailyBilling();
  }, 5000); // 5 second delay to let server fully initialize
}
