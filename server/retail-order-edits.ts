/**
 * Editing an existing retail order (owner, 2026-09-14: "delete a product, add a
 * product, etc."). Lines can be added, removed and re-quantified on any OPEN
 * order, paid or not. Money is never moved by an edit: the order remembers what
 * the customer has actually paid, the totals are recomputed from the lines, and
 * the difference is surfaced — a balance due at pickup, or an overpayment that
 * staff refund with an explicit click.
 */
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { retailOrders, retailOrderItemsV2, retailProducts } from "@shared/schema";

/** Washington sales tax applied at checkout (10.35%). Mirrors the rate in the
 *  checkout and billing paths; an edited order is re-taxed at the same rate. */
export const RETAIL_TAX_RATE = 0.1035;

type OrderRow = typeof retailOrders.$inferSelect;

/** True when a Stripe charge or invoice settled this order. */
export function isPaidOrder(order: Pick<OrderRow, "stripePaymentIntentId" | "stripeInvoiceId">): boolean {
  return !!order.stripePaymentIntentId || !!order.stripeInvoiceId;
}

/** What the customer has paid so far, net of refunds. Orders from before this
 *  column existed (and new ones until their first edit) carry null, meaning
 *  "paid in full at the current total, minus a deposit already refunded" — the
 *  same rule the migration backfilled. Unpaid orders: 0. */
export function effectiveAmountPaid(order: Pick<OrderRow, "amountPaid" | "totalAmount" | "depositAmount" | "depositRefundedAt" | "stripePaymentIntentId" | "stripeInvoiceId" | "status">): number {
  if (order.amountPaid != null) return Number(order.amountPaid);
  if (!isPaidOrder(order) || order.status === "cancelled") return 0;
  const refundedDeposit = order.depositRefundedAt ? Number(order.depositAmount ?? 0) : 0;
  return Math.max(0, Number(order.totalAmount) - refundedDeposit);
}

export type OrderTotals = {
  subtotal: number;
  tax: number;
  deposit: number;
  total: number;
  amountPaid: number;
  /** total − paid: positive = owed at pickup, negative = overpaid. */
  balance: number;
};

/** Recompute an order's stored totals from its lines. Tax follows the order's
 *  own history (an order that was taxed stays taxed; a staff pay-at-pickup order
 *  with no tax stays tax-free). The deposit is re-derived from the products
 *  unless it was already refunded, in which case the stored figure stands. The
 *  paid amount is pinned BEFORE totals move so the balance stays honest. */
export async function recomputeRetailOrderTotals(orderId: string): Promise<OrderTotals> {
  const [order] = await db.select().from(retailOrders).where(eq(retailOrders.id, orderId));
  if (!order) throw new Error("Order not found");
  const amountPaid = effectiveAmountPaid(order);

  const lines = await db
    .select({ quantity: retailOrderItemsV2.quantity, unitPrice: retailOrderItemsV2.unitPrice, deposit: retailProducts.deposit })
    .from(retailOrderItemsV2)
    .innerJoin(retailProducts, eq(retailProducts.id, retailOrderItemsV2.retailProductId))
    .where(eq(retailOrderItemsV2.orderId, orderId));

  const subtotal = lines.reduce((s, l) => s + Number(l.unitPrice) * l.quantity, 0);
  const noCharge = lines.length > 0 && lines.every((l) => Number(l.unitPrice) === 0);
  const taxed = Number(order.taxAmount ?? 0) > 0;
  const tax = taxed ? subtotal * RETAIL_TAX_RATE : 0;
  const deposit = order.depositRefundedAt
    ? Number(order.depositAmount ?? 0)
    : noCharge ? 0 : lines.reduce((s, l) => s + Number(l.deposit ?? 0) * l.quantity, 0);
  const total = subtotal + tax + deposit;

  await db
    .update(retailOrders)
    .set({
      subtotal: subtotal.toFixed(2),
      taxAmount: tax.toFixed(2),
      depositAmount: deposit.toFixed(2),
      totalAmount: total.toFixed(2),
      amountPaid: amountPaid.toFixed(2),
      updatedAt: new Date(),
    })
    .where(and(eq(retailOrders.id, orderId)));

  const money = (n: number) => Number(n.toFixed(2));
  return { subtotal: money(subtotal), tax: money(tax), deposit: money(deposit), total: money(total), amountPaid: money(amountPaid), balance: money(total - amountPaid) };
}
