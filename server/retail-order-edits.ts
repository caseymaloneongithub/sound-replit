/**
 * Editing an existing retail order (owner, 2026-09-14: "delete a product, add a
 * product, etc."). Lines can be added, removed and re-quantified on any OPEN
 * order, paid or not. Money is never moved by an edit: the order remembers what
 * the customer has actually paid, the totals are recomputed from the lines, and
 * the difference is surfaced — a balance due at pickup, or an overpayment that
 * staff refund with an explicit click.
 *
 * Every edit runs inside ONE transaction that holds the order row locked
 * (withOpenOrderLocked): validation, the line change and the recalculation
 * can't interleave with another edit's (reviewer, 2026-09-14: overlapping
 * edits left $300 of lines under a $200 total, and two deletes slipped past
 * the last-line guard).
 */
import type Stripe from "stripe";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { retailOrders, retailOrderItems, retailOrderItemsV2, retailProducts } from "@shared/schema";

/** Washington sales tax applied at checkout (10.35%). Mirrors the rate in the
 *  checkout and billing paths; an edited order is re-taxed at the same rate. */
export const RETAIL_TAX_RATE = 0.1035;

type OrderRow = typeof retailOrders.$inferSelect;
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const money = (n: number) => Number(n.toFixed(2));

/** An edit that can't proceed, with the HTTP status the route should answer. */
export class OrderEditError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** True when a Stripe charge or invoice settled this order. */
export function isPaidOrder(order: Pick<OrderRow, "stripePaymentIntentId" | "stripeInvoiceId">): boolean {
  return !!order.stripePaymentIntentId || !!order.stripeInvoiceId;
}

/** A deposit that has been returned to the customer no longer counts against
 *  them: it comes off BOTH sides of the balance (paid, and owed). */
export function returnedDeposit(order: Pick<OrderRow, "depositAmount" | "depositRefundedAt">): number {
  return order.depositRefundedAt ? Number(order.depositAmount ?? 0) : 0;
}

/** What the customer owes for the order as it stands: the stored total less
 *  any deposit already handed back. */
export function amountOwed(order: Pick<OrderRow, "totalAmount" | "depositAmount" | "depositRefundedAt">): number {
  return money(Math.max(0, Number(order.totalAmount) - returnedDeposit(order)));
}

/** What the customer has paid so far, net of refunds. Orders from before this
 *  column existed (and new ones until their first edit) carry null, meaning
 *  "paid in full for what's owed" — the same rule the migration backfilled.
 *  Unpaid orders: 0. */
export function effectiveAmountPaid(order: Pick<OrderRow, "amountPaid" | "totalAmount" | "depositAmount" | "depositRefundedAt" | "stripePaymentIntentId" | "stripeInvoiceId" | "status">): number {
  if (order.amountPaid != null) return Number(order.amountPaid);
  if (!isPaidOrder(order) || order.status === "cancelled") return 0;
  return amountOwed(order);
}

/** Positive = the customer paid more than the order now owes. */
export function overpaidAmount(order: Parameters<typeof effectiveAmountPaid>[0]): number {
  return money(effectiveAmountPaid(order) - amountOwed(order));
}

export type OrderTotals = {
  subtotal: number;
  tax: number;
  deposit: number;
  total: number;
  /** total − deposits already returned. */
  owed: number;
  amountPaid: number;
  /** owed − paid: positive = due at pickup, negative = overpaid. */
  balance: number;
};

/** Lines on both item tables: the current cart system (retail_order_items_v2)
 *  and the legacy one, which older open orders may still carry. */
export async function countOrderLines(tx: DbTx, orderId: string): Promise<number> {
  const [{ v2 }] = await tx.select({ v2: sql<number>`count(*)::int` }).from(retailOrderItemsV2).where(eq(retailOrderItemsV2.orderId, orderId));
  const [{ legacy }] = await tx.select({ legacy: sql<number>`count(*)::int` }).from(retailOrderItems).where(eq(retailOrderItems.orderId, orderId));
  return v2 + legacy;
}

/**
 * Run `fn` with the order row locked, then recompute the order's totals in the
 * same transaction. Refuses closed orders. Throws OrderEditError for anything
 * the route should turn into a 4xx.
 */
export async function withOpenOrderLocked<T>(
  orderId: string,
  fn: (tx: DbTx, order: OrderRow) => Promise<T>,
): Promise<{ result: T; totals: OrderTotals }> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(retailOrders)
      .where(and(eq(retailOrders.id, orderId), isNull(retailOrders.deletedAt)))
      .for("update");
    if (!order) throw new OrderEditError(404, "Order not found");
    if (!["pending", "ready_for_pickup"].includes(order.status)) throw new OrderEditError(400, "Only open orders can be edited");
    const result = await fn(tx, order);
    const totals = await recomputeRetailOrderTotals(tx, order);
    return { result, totals };
  });
}

/** Recompute an order's stored totals from its lines (both item tables). Tax
 *  follows the order's own history (an order that was taxed stays taxed; a
 *  staff pay-at-pickup order with no tax stays tax-free). The deposit is
 *  re-derived from the products — except on subscription orders, which never
 *  carry deposits, and once a deposit has been refunded, where the stored
 *  figure stands. The paid amount is pinned BEFORE totals move so the balance
 *  stays honest. `order` is the row as read under the caller's lock. */
export async function recomputeRetailOrderTotals(tx: DbTx, order: OrderRow): Promise<OrderTotals> {
  const amountPaid = effectiveAmountPaid(order);

  const v2 = await tx
    .select({ quantity: retailOrderItemsV2.quantity, unitPrice: retailOrderItemsV2.unitPrice, deposit: retailProducts.deposit })
    .from(retailOrderItemsV2)
    .innerJoin(retailProducts, eq(retailProducts.id, retailOrderItemsV2.retailProductId))
    .where(eq(retailOrderItemsV2.orderId, order.id));
  const legacy = await tx
    .select({ quantity: retailOrderItems.quantity, unitPrice: retailOrderItems.unitPrice })
    .from(retailOrderItems)
    .where(eq(retailOrderItems.orderId, order.id));

  const lines = [...v2, ...legacy];
  const subtotal = lines.reduce((s, l) => s + Number(l.unitPrice) * l.quantity, 0);
  const noCharge = lines.length > 0 && lines.every((l) => Number(l.unitPrice) === 0);
  const taxed = Number(order.taxAmount ?? 0) > 0;
  const tax = taxed ? subtotal * RETAIL_TAX_RATE : 0;
  const deposit = order.isSubscriptionOrder || order.depositRefundedAt
    ? Number(order.depositAmount ?? 0)
    : noCharge ? 0 : v2.reduce((s, l) => s + Number(l.deposit ?? 0) * l.quantity, 0);
  const total = subtotal + tax + deposit;

  await tx
    .update(retailOrders)
    .set({
      subtotal: subtotal.toFixed(2),
      taxAmount: tax.toFixed(2),
      depositAmount: deposit.toFixed(2),
      totalAmount: total.toFixed(2),
      amountPaid: amountPaid.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(retailOrders.id, order.id));

  const owed = money(Math.max(0, total - (order.depositRefundedAt ? deposit : 0)));
  return {
    subtotal: money(subtotal),
    tax: money(tax),
    deposit: money(deposit),
    total: money(total),
    owed,
    amountPaid: money(amountPaid),
    balance: money(owed - amountPaid),
  };
}

/**
 * Refund what the customer overpaid after edits shrank an order. Serialized on
 * the order row, so two clicks (or two tabs) can't each refund the same
 * overpayment: the second waits, re-reads, finds nothing overpaid. The Stripe
 * call carries an idempotency key built from the amounts, so a retry after
 * Stripe succeeded but the database write failed gets the SAME refund back
 * instead of a second one. Money first, then the book.
 */
export async function refundOverpayment(stripe: Stripe, orderId: string): Promise<{ refundId: string; amount: number }> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(retailOrders)
      .where(and(eq(retailOrders.id, orderId), isNull(retailOrders.deletedAt)))
      .for("update");
    if (!order) throw new OrderEditError(404, "Order not found");
    if (order.status === "cancelled") throw new OrderEditError(400, "Order is cancelled");
    if (!order.stripePaymentIntentId) {
      throw new OrderEditError(400, "This order wasn't paid by card through the site — refund it where it was paid");
    }
    const paid = effectiveAmountPaid(order);
    const owed = amountOwed(order);
    const overpaid = money(paid - owed);
    if (overpaid <= 0) throw new OrderEditError(400, "Nothing to refund — the customer hasn't overpaid");

    const refund = await stripe.refunds.create(
      { payment_intent: order.stripePaymentIntentId, amount: Math.round(overpaid * 100) },
      { idempotencyKey: `retail-overpayment:${order.id}:${paid.toFixed(2)}:${owed.toFixed(2)}` },
    );
    await tx
      .update(retailOrders)
      .set({
        amountPaid: owed.toFixed(2),
        notes: `${order.notes ? order.notes + " — " : ""}Refunded $${overpaid.toFixed(2)} difference after edit (${new Date().toLocaleDateString("en-US")})`,
        updatedAt: new Date(),
      })
      .where(eq(retailOrders.id, order.id));
    console.log(`[RETAIL EDIT] Refunded $${overpaid.toFixed(2)} on ${order.orderNumber}: ${refund.id}`);
    return { refundId: refund.id, amount: overpaid };
  });
}
