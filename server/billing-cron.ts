import cron from 'node-cron';
import Stripe from 'stripe';
import { db } from './db';
import { pool } from './storage';
import { retailOrders, retailOrderItemsV2, retailSubscriptions, retailSubscriptionItems, retailProducts, flavors, users } from '../shared/schema';
import { eq, and, lte, sql, gte, lt, or, isNull } from 'drizzle-orm';
import { normalizeToAllowedPickupDay, getBillingDateForPickup, PICKUP_POLICY } from '../shared/pickup-policy';
import { frequencyToDays } from '../shared/subscription-frequency';

/** A processing lock older than this is treated as stranded and reclaimed. */
const STALE_LOCK_MINUTES = 30;

/**
 * The price to charge for a subscription line.
 *
 * Prefers the price locked in at signup so a catalogue edit never silently
 * re-prices an existing subscriber. Falls back to the current discounted price for
 * rows created before unitPriceAtSignup existed.
 */
function resolveUnitPrice(item: {
  unitPriceAtSignup?: string | null;
  retailProduct: { price: string; subscriptionDiscount?: string | number | null } | null;
}): number {
  if (item.unitPriceAtSignup != null) {
    const locked = parseFloat(String(item.unitPriceAtSignup));
    if (Number.isFinite(locked)) return locked;
  }
  if (!item.retailProduct) return 0;
  const basePrice = parseFloat(item.retailProduct.price);
  const discount = item.retailProduct.subscriptionDiscount ? Number(item.retailProduct.subscriptionDiscount) : 0;
  return basePrice * (1 - discount / 100);
}
import {
  sendBillingReminderEmail,
  sendSubscriptionChargeConfirmationEmail,
  sendPaymentFailureEmail,
  sendStaffPaymentFailureNotification,
} from './email';
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
        unitPriceAtSignup: retailSubscriptionItems.unitPriceAtSignup,
        notes: retailSubscriptionItems.notes,
        retailProduct: retailProducts,
      })
      .from(retailSubscriptionItems)
      .leftJoin(retailProducts, eq(retailSubscriptionItems.retailProductId, retailProducts.id))
      .where(eq(retailSubscriptionItems.subscriptionId, sub.id));

    // Extract payment amounts from metadata
    const subtotal = parseFloat(paymentIntent.metadata.subtotal || '0');
    const taxAmount = parseFloat(paymentIntent.metadata.taxAmount || '0');
    const totalAmount = parseFloat(paymentIntent.metadata.totalAmount || '0');

    // Calculate the next charge/pickup dates before opening the transaction.
    //
    // Advance from the SCHEDULED pickup, not from now — a billing run that fires late
    // must not push every subsequent pickup later. (Semantics adopted from the parallel
    // date-drift fix on main.)
    //
    // frequencyToDays throws on non-canonical values, and at this point the customer's
    // card is ALREADY CHARGED — throwing here would strand a paid charge with no order,
    // permanently, since every retry hits the same throw. Fall back to 28 days and log
    // loudly instead: a wrong cadence is staff-recoverable; a charge with no order is
    // the exact failure state this function exists to prevent.
    let daysUntilNext: number;
    try {
      daysUntilNext = frequencyToDays(sub.subscriptionFrequency);
    } catch {
      console.error(`🚨 [BILLING] Subscription ${sub.id} has unrecognized frequency "${sub.subscriptionFrequency}" — falling back to 28 days. Fix the subscription row.`);
      daysUntilNext = 28;
    }

    // A SIGNUP charge is not a renewal (owner, 2026-08-31): the customer pays now and
    // picks up NOW — the schedule checkout wrote (next cycle, one frequency out) already
    // points at cycle two and must NOT advance again, or the first pickup lands a full
    // cycle away and the next charge two cycles away (how Kirk got an Oct pickup for an
    // Aug order).
    const isFirstOrder = paymentIntent.metadata.type === 'retail_subscription_first_order';
    const orderPickupDate = isFirstOrder
      ? normalizeToAllowedPickupDay(new Date())
      : (sub.nextDeliveryDate || new Date());
    const normalizedNextPickupDate = isFirstOrder
      ? (sub.nextDeliveryDate ?? normalizeToAllowedPickupDay(addDays(new Date(), daysUntilNext)))
      : normalizeToAllowedPickupDay(addDays(sub.nextDeliveryDate || new Date(), daysUntilNext));
    // Billing happens on Monday of the pickup week
    const nextBillingDate = isFirstOrder && sub.nextChargeAt
      ? sub.nextChargeAt
      : getBillingDateForPickup(normalizedNextPickupDate);

    // The customer's card is ALREADY charged at this point, so the order, its line
    // items and the subscription's date advance must all land together. Previously
    // these were three separate statements: a crash between them left a charged
    // customer with an empty order and a subscription that would bill again.
    //
    // Uses the WebSocket pool (not the neon-http `db`) because we need a real
    // interactive transaction plus an advisory lock — the order number was
    // previously derived from count(*) in two places with inconsistent deleted_at
    // filtering, which could collide and throw AFTER the charge.
    const orderClient = await pool.connect();
    let orderNumber: string;
    try {
      await orderClient.query('BEGIN');

      // Serialize order-number generation for the duration of this transaction
      await orderClient.query('SELECT pg_advisory_xact_lock($1)', [123456789]);

      // Numbering considers ALL rows, soft-deleted included: order_number is globally
      // unique, so a soft-deleted order keeps its number reserved. Filtering deleted_at
      // here meant that whenever the highest-numbered order was soft-deleted, the next
      // billing run re-minted its number and the INSERT below failed — after the charge.
      // MAX over the numeric part (not lexicographic ORDER BY) so RO-1000000 sorts right.
      const lastNumber = await orderClient.query(
        `SELECT MAX(CAST(SUBSTRING(order_number FROM 4) AS bigint)) AS last_seq
         FROM retail_orders
         WHERE order_number ~ '^RO-[0-9]+$'`
      );
      const lastSeq = Number(lastNumber.rows[0]?.last_seq ?? 0);
      orderNumber = `RO-${String(lastSeq + 1).padStart(6, '0')}`;

      const inserted = await orderClient.query(
        `INSERT INTO retail_orders
           (order_number, customer_name, customer_email, customer_phone, status,
            subtotal, tax_amount, total_amount, stripe_payment_intent_id,
            is_subscription_order, user_id, pickup_date)
         VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,true,$9,$10)
         RETURNING id`,
        [
          orderNumber,
          sub.customerName,
          sub.customerEmail,
          sub.customerPhone,
          subtotal.toFixed(2),
          taxAmount.toFixed(2),
          totalAmount.toFixed(2),
          paymentIntentId,
          sub.userId,
          orderPickupDate, // the pickup this charge pays for (signup = now, renewal = scheduled)
        ]
      );
      const newOrderId = inserted.rows[0].id;

      for (const item of items) {
        if (!item.retailProduct) continue;

        const unitPrice = resolveUnitPrice(item);

        await orderClient.query(
          `INSERT INTO retail_order_items_v2
             (order_id, retail_product_id, selected_flavor_id, quantity, unit_price, notes)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [newOrderId, item.retailProductId, item.selectedFlavorId, item.quantity, unitPrice.toFixed(2), item.notes ?? null]
        );
      }

      await orderClient.query(
        `UPDATE retail_subscriptions
         SET next_charge_at = $1, next_delivery_date = $2, billing_status = 'active',
             retry_count = 0, last_payment_intent_id = $3, last_refunded_at = NULL,
             processing_lock = false, processing_locked_at = NULL
         WHERE id = $4`,
        [nextBillingDate, normalizedNextPickupDate, paymentIntentId, sub.id]
      );

      await orderClient.query('COMMIT');
    } catch (txError) {
      await orderClient.query('ROLLBACK').catch(() => {});
      throw txError;
    } finally {
      orderClient.release();
    }

    console.log(`[BILLING] ✅ Finalized retail subscription charge ${sub.id} - Order ${orderNumber} created`);

    // Send charge confirmation email with pickup instructions
    try {
      // The pickup this charge pays for (signup = now, renewal = the scheduled date)
      const pickupDate = orderPickupDate;
      
      // Build subscription items with product and flavor names for the email
      const subscriptionItemsForEmail = await Promise.all(items.map(async (item) => {
        if (!item.retailProduct) {
          return null;
        }
        
        // Get flavor name if selected
        let flavorName: string | undefined;
        if (item.selectedFlavorId) {
          const [flavor] = await db
            .select({ name: flavors.name })
            .from(flavors)
            .where(eq(flavors.id, item.selectedFlavorId));
          flavorName = flavor?.name;
        }
        
        const basePrice = parseFloat(item.retailProduct.price);
        const discount = item.retailProduct.subscriptionDiscount ? Number(item.retailProduct.subscriptionDiscount) : 0;
        const unitPrice = basePrice * (1 - discount / 100);
        const itemTotal = unitPrice * item.quantity;
        
        return {
          productName: item.retailProduct.productName || 'Product',
          quantity: item.quantity,
          flavorName,
          price: `$${itemTotal.toFixed(2)}`,
        };
      }));
      
      const validItems = subscriptionItemsForEmail.filter((item): item is NonNullable<typeof item> => item !== null);
      
      if (sub.customerEmail && validItems.length > 0) {
        await sendSubscriptionChargeConfirmationEmail({
          customerEmail: sub.customerEmail,
          customerName: sub.customerName,
          pickupDate: new Date(pickupDate),
          subscriptionItems: validItems,
          totalAmount: totalAmount,
          orderNumber,
        });
      }
    } catch (emailError) {
      // Log but don't fail the billing process if email fails
      console.error(`[BILLING] Failed to send confirmation email for subscription ${sub.id}:`, emailError);
    }

    return true;
  } catch (error: any) {
    // The card may already have been charged at this point, so this is the highest
    // priority failure state in the whole system. The retry is safe: nextChargeAt was
    // not advanced, the lock is released by the caller's finally, and the idempotency
    // key makes Stripe return the SAME PaymentIntent rather than charging again.
    console.error(
      `[BILLING] 🚨 FAILED TO FINALIZE a charge for PaymentIntent ${paymentIntentId}. ` +
        `The customer may have been charged WITHOUT an order being created. ` +
        `It will be retried on the next billing run.`,
      error
    );
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
    subtotal += resolveUnitPrice(item) * item.quantity;
  }

  const taxAmount = subtotal * TAX_RATE;
  const totalAmount = subtotal + taxAmount;
  
  const amountInCents = Math.round(totalAmount * 100);

  // Derived from the BILLING PERIOD, never from Date.now(): if the response to a
  // charge is lost (timeout/5xx/process restart), the retry presents the same key
  // and Stripe returns the original PaymentIntent instead of charging again.
  // Note billing also runs on every server start, so restarts are a real retry path.
  const idempotencyKey = `retailsub_${subscription.id}_${
    subscription.nextChargeAt instanceof Date
      ? subscription.nextChargeAt.toISOString()
      : String(subscription.nextChargeAt)
  }`;

  // Migrated subscriptions start with no Stripe ids on the row: the customer record
  // appears when they first open the billing portal (saved on the USER), and the card
  // they add lives on that customer. Resolve both here and remember them on the
  // subscription so this lookup runs once. No card yet -> throw the same shape as a
  // decline, so the existing dunning email + 2/4/7-day retry backoff take over.
  if (!subscription.stripeCustomerId && subscription.userId) {
    const [owner] = await db.select().from(users).where(eq(users.id, subscription.userId)).limit(1);
    if (owner?.stripeCustomerId) subscription.stripeCustomerId = owner.stripeCustomerId;
  }
  if (!subscription.stripePaymentMethodId && subscription.stripeCustomerId) {
    try {
      const cust: any = await stripe.customers.retrieve(subscription.stripeCustomerId);
      let adopted = cust?.invoice_settings?.default_payment_method ?? null;
      if (adopted && typeof adopted !== 'string') adopted = adopted.id;
      if (!adopted) {
        // No type filter: portal-saved cards often arrive as type 'link', and ACH
        // would be us_bank_account — any of them can carry an off-session charge.
        const pms = await stripe.paymentMethods.list({ customer: subscription.stripeCustomerId, limit: 10 });
        adopted = pms.data.find((pm) => pm.card || pm.link || pm.us_bank_account)?.id ?? null;
      }
      if (adopted) {
        subscription.stripePaymentMethodId = adopted;
        console.log(`[BILLING] Adopted card ${adopted} for subscription ${subscription.id} from the customer's Stripe profile`);
      }
    } catch (e: any) {
      console.warn(`[BILLING] Payment-method lookup failed for ${subscription.id}: ${e.message}`);
    }
  }
  if (subscription.stripeCustomerId || subscription.stripePaymentMethodId) {
    await db.update(retailSubscriptions)
      .set({
        ...(subscription.stripeCustomerId ? { stripeCustomerId: subscription.stripeCustomerId } : {}),
        ...(subscription.stripePaymentMethodId ? { stripePaymentMethodId: subscription.stripePaymentMethodId } : {}),
      })
      .where(eq(retailSubscriptions.id, subscription.id));
  }

  try {
    if (!subscription.stripeCustomerId || !subscription.stripePaymentMethodId) {
      const err: any = new Error('No payment method on file — the customer needs to add a card in My Account');
      err.type = 'StripeCardError';
      err.code = 'no_payment_method';
      throw err;
    }

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
    }, { idempotencyKey });

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

    const newRetryCount = subscription.retryCount + 1;
    const exhausted = newRetryCount >= MAX_RETRY_ATTEMPTS;

    // A StripeCardError is a DEFINITIVE decline — Stripe processed the request and
    // refused it, so no money moved. Anything else (timeout, connection reset, 5xx)
    // is AMBIGUOUS: the charge may well have succeeded and we simply lost the reply.
    const isDefiniteDecline = error?.type === 'StripeCardError';

    // Only back off for definite declines. The idempotency key is derived from
    // nextChargeAt, so moving that date mints a NEW key — which is correct for a
    // fresh attempt after a decline, but would DOUBLE-CHARGE on an ambiguous
    // failure. Leaving the date untouched makes the next run reuse the same key,
    // and Stripe returns the original PaymentIntent instead of charging again.
    let retryAt: Date | undefined;
    if (isDefiniteDecline && !exhausted) {
      const backoffDays = Math.min(2 ** newRetryCount, 7); // 2, 4, then 7 days
      retryAt = new Date();
      retryAt.setDate(retryAt.getDate() + backoffDays);
      console.log(`[BILLING] Card declined for ${subscription.id} — retry ${newRetryCount}/${MAX_RETRY_ATTEMPTS} scheduled in ${backoffDays} day(s)`);
    } else if (!isDefiniteDecline) {
      console.warn(`[BILLING] ⚠️ Ambiguous failure for ${subscription.id} (${error?.type ?? 'unknown'}) — keeping nextChargeAt so the retry reuses the same idempotency key and cannot double-charge`);
    }

    await db
      .update(retailSubscriptions)
      .set({
        retryCount: newRetryCount,
        billingStatus: exhausted ? 'retrying' : 'active',
        lastPaymentIntentId: error.payment_intent?.id || null,
        processingLock: false,
        processingLockedAt: null,
        status: exhausted ? 'paused' : subscription.status,
        ...(retryAt ? { nextChargeAt: retryAt } : {}),
      })
      .where(eq(retailSubscriptions.id, subscription.id));

    // Tell someone. These templates already existed but were never wired up, so a
    // customer's card could fail three times and the subscription pause itself,
    // with nobody — customer or owner — ever being told.
    try {
      const subscriptionItems = items
        .filter((i) => i.retailProduct)
        .map((i) => ({
          productName: i.retailProduct!.productName || i.retailProduct!.unitDescription || 'Kombucha',
          quantity: i.quantity,
        }));

      if (subscription.customerEmail) {
        await sendPaymentFailureEmail({
          customerEmail: subscription.customerEmail,
          customerName: subscription.customerName || 'there',
          subscriptionItems,
          amount: totalAmount,
          errorMessage: error?.message || 'Your card was declined.',
        });
      }

      await sendStaffPaymentFailureNotification({
        customerEmail: subscription.customerEmail || '(unknown)',
        customerName: subscription.customerName || '(unknown)',
        subscriptionItems,
        amount: totalAmount,
        errorMessage: `${error?.message || 'Payment failed'} (attempt ${newRetryCount}/${MAX_RETRY_ATTEMPTS}${exhausted ? ' — SUBSCRIPTION PAUSED' : ''})`,
      });
    } catch (emailError) {
      console.error(`[BILLING] Failed to send payment-failure notification for ${subscription.id}:`, emailError);
    }

    if (exhausted) {
      console.error(`[BILLING] 🚨 Retail subscription ${subscription.id} PAUSED after ${MAX_RETRY_ATTEMPTS} failed attempts — needs staff action to resume (POST /api/retail-subscriptions/:id/reset-billing)`);
    }

    return false;
  }
}

/**
 * Customer-initiated immediate retry after a failed payment ("I fixed my card,
 * charge it now"). Safe against double-charges: the idempotency key derives from
 * nextChargeAt, which this does not change, so re-presenting the same billing
 * period returns the original PaymentIntent. retryCount is deliberately kept —
 * repeated failed retries still march toward the pause.
 */
export async function chargeSubscriptionNow(subscriptionId: string): Promise<{ ok: boolean; message: string }> {
  if (!stripe) return { ok: false, message: "Billing isn't configured" };
  const [sub] = await db.select().from(retailSubscriptions).where(eq(retailSubscriptions.id, subscriptionId));
  if (!sub) return { ok: false, message: 'Subscription not found' };
  if (sub.status === 'cancelled') return { ok: false, message: 'This subscription is cancelled' };
  if (!['retrying', 'payment_failed', 'awaiting_auth'].includes(sub.billingStatus)) {
    return { ok: false, message: 'There is no failed payment to retry on this subscription' };
  }
  const lock = await db.update(retailSubscriptions)
    .set({ processingLock: true, processingLockedAt: new Date() })
    .where(and(eq(retailSubscriptions.id, subscriptionId), eq(retailSubscriptions.processingLock, false)))
    .returning({ id: retailSubscriptions.id });
  if (lock.length === 0) return { ok: false, message: 'A payment attempt is already in progress — check back in a minute' };
  try {
    // Back to active so the charge and its bookkeeping run the normal path.
    await db.update(retailSubscriptions)
      .set({ status: 'active', billingStatus: 'active' })
      .where(eq(retailSubscriptions.id, subscriptionId));
    const items = await db
      .select({
        id: retailSubscriptionItems.id,
        subscriptionId: retailSubscriptionItems.subscriptionId,
        retailProductId: retailSubscriptionItems.retailProductId,
        selectedFlavorId: retailSubscriptionItems.selectedFlavorId,
        quantity: retailSubscriptionItems.quantity,
        unitPriceAtSignup: retailSubscriptionItems.unitPriceAtSignup,
        notes: retailSubscriptionItems.notes,
        retailProduct: retailProducts,
      })
      .from(retailSubscriptionItems)
      .leftJoin(retailProducts, eq(retailSubscriptionItems.retailProductId, retailProducts.id))
      .where(eq(retailSubscriptionItems.subscriptionId, subscriptionId));
    if (items.length === 0) return { ok: false, message: 'This subscription has no items' };
    console.log(`[BILLING] Customer-initiated retry for ${subscriptionId}`);
    const ok = await processRetailSubscriptionBilling({ ...sub, status: 'active', billingStatus: 'active' }, items);
    return ok
      ? { ok: true, message: 'Payment went through — your next case is on the schedule.' }
      : { ok: false, message: "The charge didn't go through — double-check your payment method and try again." };
  } finally {
    await db.update(retailSubscriptions)
      .set({ processingLock: false, processingLockedAt: null })
      .where(eq(retailSubscriptions.id, subscriptionId));
  }
}

export async function runDailyBilling() {
  console.log('[BILLING] Starting daily billing process...');

  try {
    const now = new Date();

    // Reclaim stale locks BEFORE selecting work. A lock is only meant to last for the
    // duration of one charge; anything older was stranded by a crash or a swallowed
    // error. Because the due-query excludes locked rows, a stranded lock silently
    // removes the subscription from billing forever — two were stuck this way for
    // five months before this reaper existed.
    const staleLockCutoff = new Date(now.getTime() - STALE_LOCK_MINUTES * 60 * 1000);
    const reclaimed = await db
      .update(retailSubscriptions)
      .set({ processingLock: false, processingLockedAt: null })
      .where(
        and(
          eq(retailSubscriptions.processingLock, true),
          or(
            isNull(retailSubscriptions.processingLockedAt),
            lt(retailSubscriptions.processingLockedAt, staleLockCutoff)
          )
        )
      )
      .returning({ id: retailSubscriptions.id, lockedAt: retailSubscriptions.processingLockedAt });

    if (reclaimed.length > 0) {
      console.warn(
        `[BILLING] ⚠️ Reclaimed ${reclaimed.length} stale processing lock(s) — these subscriptions were stuck and not billing: ${reclaimed
          .map((r) => r.id)
          .join(', ')}`
      );
    }

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

    // Per-run tallies so a silent failure is visible in the summary below.
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    // Process each retail subscription
    for (const subscription of dueRetailSubscriptions) {
      // Tracked so the `finally` only releases a lock this iteration actually took.
      let lockAcquired = false;
      try {
        // Atomically acquire lock
        const lockResult = await db
          .update(retailSubscriptions)
          .set({ processingLock: true, processingLockedAt: new Date() })
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
          skipped++;
          continue;
        }
        lockAcquired = true;

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
          skipped++;
          continue;
        }

        // Process the billing
        const ok = await processRetailSubscriptionBilling(subscription, items);
        if (ok) succeeded++;
        else failed++;
      } catch (error) {
        failed++;
        console.error(`[BILLING] Error processing retail subscription ${subscription.id}:`, error);
      } finally {
        // ALWAYS release the lock. Previously a swallowed error inside
        // finalizeRetailSubscriptionCharge left processingLock=true forever, and the
        // due-subscription query excludes locked rows — so the subscription silently
        // stopped billing with no alert. (Two live subscriptions were stranded this
        // way since February.) Releasing is safe: the success path already sets it
        // false, and re-setting false is a no-op.
        if (lockAcquired) {
          try {
            await db
              .update(retailSubscriptions)
              .set({ processingLock: false, processingLockedAt: null })
              .where(eq(retailSubscriptions.id, subscription.id));
          } catch (releaseError) {
            console.error(`[BILLING] ⚠️ FAILED TO RELEASE LOCK for ${subscription.id} — it will not bill again until cleared:`, releaseError);
          }
        }
      }
    }

    // Single summary line per run. Previously every outcome was buried in per-item
    // logs, so a run where everything failed looked identical to a quiet one — the
    // owner's only signal was noticing orders had stopped appearing.
    const summary = `[BILLING] Run summary — due: ${dueRetailSubscriptions.length}, charged: ${succeeded}, failed: ${failed}, skipped: ${skipped}, stale locks reclaimed: ${reclaimed.length}`;
    if (failed > 0 || reclaimed.length > 0) {
      console.warn(`${summary}  ⚠️ NEEDS ATTENTION`);
    } else {
      console.log(summary);
    }

    console.log('[BILLING] Daily billing process completed');
  } catch (error) {
    console.error('[BILLING] 🚨 Fatal error in daily billing process — NO subscriptions were billed this run:', error);
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
  
  // Run billing at 4:00 AM Pacific. The timezone MUST be pinned: nextChargeAt is
  // computed as Monday 04:00 Pacific, so an unpinned (UTC) schedule fires ~17h early
  // and sees charges as not-yet-due.
  cron.schedule('0 4 * * *', async () => {
    console.log('[BILLING] Cron triggered at 4:00 AM Pacific');
    await runDailyBilling();
  }, { timezone: PICKUP_POLICY.timezone });

  // Run billing reminders at 9:00 AM every day (2 days before billing)
  cron.schedule('0 9 * * *', async () => {
    console.log('[BILLING REMINDERS] Cron triggered at 9:00 AM Pacific');
    await sendBillingReminders();
  }, { timezone: PICKUP_POLICY.timezone });

  // Also run on startup to catch any missed billings
  setTimeout(async () => {
    console.log('[BILLING] Running initial billing check on startup');
    await runDailyBilling();
  }, 5000); // 5 second delay to let server fully initialize
}
