import cron from 'node-cron';
import Stripe from 'stripe';
import { db } from './db';
import { subscriptions, subscriptionItems, products, retailOrders, retailOrderItems, inventoryAdjustments } from '../shared/schema';
import { eq, and, lte, sql } from 'drizzle-orm';
import { sendPaymentFailureEmail, sendStaffPaymentFailureNotification } from './email';

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' })
  : null;

const MAX_RETRY_ATTEMPTS = 3;

async function processSubscriptionBilling(subscription: any, items: any[]) {
  if (!stripe) {
    console.error('[BILLING] Stripe not configured');
    return false;
  }

  // Calculate total amount
  const CASE_PRICE_WITH_DISCOUNT = 54.00; // $60 - 10% subscription discount
  const totalAmount = items.reduce((sum, item) => sum + (CASE_PRICE_WITH_DISCOUNT * item.quantity), 0);
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
      },
    });

    if (paymentIntent.status === 'succeeded') {
      // Payment successful - create order and deduct inventory
      await db.transaction(async (tx) => {
        // Generate order number
        const orderCount = await tx.select({ count: sql<number>`count(*)` }).from(retailOrders);
        const orderNumber = `RO-${String((orderCount[0].count as number) + 1).padStart(6, '0')}`;

        // Create retail order
        const [newOrder] = await tx.insert(retailOrders).values({
          orderNumber,
          customerName: subscription.customerName,
          customerEmail: subscription.customerEmail,
          customerPhone: subscription.customerPhone,
          status: 'pending',
          subtotal: totalAmount.toFixed(2),
          taxAmount: '0',
          totalAmount: totalAmount.toFixed(2),
          stripePaymentIntentId: paymentIntent.id,
          isSubscriptionOrder: true,
          userId: subscription.userId,
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
          subscription.subscriptionFrequency === 'weekly' ? 7 :
          subscription.subscriptionFrequency === 'bi-weekly' ? 14 :
          28;

        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + daysUntilNext);

        // Lock subscription and update
        await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, subscription.id))
          .for('update');

        await tx
          .update(subscriptions)
          .set({
            nextChargeAt: nextDate,
            nextDeliveryDate: nextDate,
            retryCount: 0,
            lastPaymentIntentId: paymentIntent.id,
            processingLock: false,
          })
          .where(eq(subscriptions.id, subscription.id));

        console.log(`[BILLING] ✅ Successfully charged subscription ${subscription.id} - Order ${orderNumber} created`);
      });

      return true;
    } else {
      console.warn(`[BILLING] Payment intent ${paymentIntent.id} status: ${paymentIntent.status}`);
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
    const dueSubscriptions = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.billingType, 'local_managed'),
          eq(subscriptions.status, 'active'),
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

// Schedule daily billing at 4:00 AM Pacific Time
// Using cron: '0 4 * * *' runs at 4:00 AM server time
export function startBillingCron() {
  console.log('[BILLING] Scheduling daily billing cron job for 4:00 AM');
  
  // Run at 4:00 AM every day
  cron.schedule('0 4 * * *', async () => {
    console.log('[BILLING] Cron triggered at 4:00 AM');
    await runDailyBilling();
  });

  // Also run on startup to catch any missed billings
  setTimeout(async () => {
    console.log('[BILLING] Running initial billing check on startup');
    await runDailyBilling();
  }, 5000); // 5 second delay to let server fully initialize
}
