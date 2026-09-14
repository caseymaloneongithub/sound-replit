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
 *
 * Refunds are persisted operations (runRetailRefund): recorded with their
 * Stripe idempotency key BEFORE the Stripe call, settled after it, and a
 * pending one is always reconciled before a new refund is allowed — so a
 * refund that reached Stripe but whose bookkeeping failed can never be issued
 * a second time, however the order is edited in between.
 */
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { retailOrders, retailOrderItems, retailOrderItemsV2, retailOrderRefunds, retailProducts } from "@shared/schema";

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
    // A refund recorded but not yet settled was sized from the order as it
    // was; an edit now (say, a deposit going from $30 to $60) would make the
    // settlement credit the wrong figure. Edits wait until it lands.
    const [inFlight] = await tx
      .select({ id: retailOrderRefunds.id })
      .from(retailOrderRefunds)
      .where(and(eq(retailOrderRefunds.orderId, orderId), eq(retailOrderRefunds.status, "pending")));
    if (inFlight) throw new OrderEditError(409, "A refund is in progress on this order — try again in a moment");
    const result = await fn(tx, order);
    const totals = await recomputeRetailOrderTotals(tx, order);
    return { result, totals };
  });
}

/** Recompute an order's stored totals from its lines (both item tables). Tax
 *  follows the order's own history (an order that was taxed stays taxed; a
 *  staff pay-at-pickup order with no tax stays tax-free). Deposits come from
 *  each line's deposit AS CHARGED (deposit_each; the catalogue figure stands in
 *  for rows that predate the column), so a flavor swap or quantity edit never
 *  re-prices a keg deposit — except on subscription orders, which never carry
 *  deposits, and once a deposit has been refunded, where the stored figure
 *  stands. The paid amount is pinned BEFORE totals move so the balance stays
 *  honest. `order` is the row as read under the caller's lock. */
export async function recomputeRetailOrderTotals(tx: DbTx, order: OrderRow): Promise<OrderTotals> {
  const amountPaid = effectiveAmountPaid(order);

  const v2 = await tx
    .select({
      quantity: retailOrderItemsV2.quantity,
      unitPrice: retailOrderItemsV2.unitPrice,
      depositEach: retailOrderItemsV2.depositEach,
      catalogueDeposit: retailProducts.deposit,
    })
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
    : noCharge ? 0 : v2.reduce((s, l) => s + Number(l.depositEach ?? l.catalogueDeposit ?? 0) * l.quantity, 0);
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

export type RefundKind = "overpayment" | "deposit";
/** The slice of Stripe a refund needs — a test can hand in a stand-in. */
export type RefundGateway = { refunds: { create: Stripe["refunds"]["create"]; list: Stripe["refunds"]["list"] } };

/** Stripe metadata key that ties a refund back to the operation that made it. */
const OP_METADATA_KEY = "retail_refund_op";

type StripeRefundSummary = { id: string; amount: number; created: number; metadata?: Record<string, string> | null };

/** Every refund Stripe has against the charge. The list is the authoritative
 *  record — idempotency keys are only kept ~24 hours, so a key alone can't
 *  answer "did this already go through?" for an operation that stalled. */
async function listRefunds(stripe: RefundGateway, paymentIntentId: string): Promise<StripeRefundSummary[]> {
  const out: StripeRefundSummary[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 10; page++) {
    const batch = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    out.push(...batch.data.map((r) => ({ id: r.id, amount: r.amount, created: r.created, metadata: r.metadata })));
    if (!batch.has_more || batch.data.length === 0) break;
    startingAfter = batch.data[batch.data.length - 1].id;
  }
  return out;
}

type OpRow = typeof retailOrderRefunds.$inferSelect;

/**
 * The refund a pending operation already produced, if any. Tagged operations
 * are matched by the operation id in the refund's metadata. Older operations
 * (recorded before refunds carried that tag) get a separate path: the earliest
 * refund of the same amount, created no earlier than the operation, that no
 * other operation on this order has claimed.
 */
async function findRefundForOp(stripe: RefundGateway, paymentIntentId: string, op: OpRow): Promise<{ id: string } | null> {
  const refunds = await listRefunds(stripe, paymentIntentId);
  const tagged = refunds.find((r) => r.metadata?.[OP_METADATA_KEY] === op.id);
  if (tagged) return { id: tagged.id };

  // Refunds claimed by OTHER operations on this order. The operation being
  // recovered is excluded on purpose: a concurrent recovery may already have
  // settled it with the very refund we are looking for, and treating that as
  // "taken" would make this caller issue a second one (reviewer, 2026-09-14).
  const claimed = new Set(
    (await db.select({ id: retailOrderRefunds.id, refundId: retailOrderRefunds.stripeRefundId }).from(retailOrderRefunds).where(eq(retailOrderRefunds.orderId, op.orderId)))
      .filter((r) => r.id !== op.id && !!r.refundId)
      .map((r) => r.refundId as string),
  );
  const cents = Math.round(Number(op.amount) * 100);
  const notBefore = Math.floor(op.createdAt.getTime() / 1000) - 60;
  const untagged = refunds
    .filter((r) => !r.metadata?.[OP_METADATA_KEY] && r.amount === cents && r.created >= notBefore && !claimed.has(r.id))
    .sort((a, b) => a.created - b.created)[0];
  return untagged ? { id: untagged.id } : null;
}

/**
 * Get the refund for an operation: the one Stripe already has, or a new one.
 * A retry under the operation's key carries the same parameters (tag
 * included), so a modern operation retries cleanly. An older operation's key
 * was used WITHOUT the tag: Stripe answers a parameter mismatch, which proves
 * the original request reached it — so Stripe's record decides, and only if
 * that shows no refund is one issued under a fresh key.
 */
/** A refund another caller already recorded against this very operation —
 *  two staff retrying the same stalled refund must end up sharing one. */
async function refundAlreadyRecorded(op: OpRow): Promise<{ id: string } | null> {
  const [row] = await db.select({ status: retailOrderRefunds.status, refundId: retailOrderRefunds.stripeRefundId }).from(retailOrderRefunds).where(eq(retailOrderRefunds.id, op.id));
  return row?.status === "done" && row.refundId ? { id: row.refundId } : null;
}

/** The Node SDK reports an idempotency-key parameter mismatch as
 *  type "StripeIdempotencyError" (the wire name lives in rawType). */
const isIdempotencyMismatch = (error: any) =>
  error?.type === "StripeIdempotencyError" || error?.rawType === "idempotency_error" || error?.type === "idempotency_error";

async function issueOrFindRefund(stripe: RefundGateway, paymentIntentId: string, op: OpRow, reconciling: boolean): Promise<{ id: string }> {
  if (reconciling) {
    const existing = (await refundAlreadyRecorded(op)) ?? (await findRefundForOp(stripe, paymentIntentId, op));
    if (existing) return existing;
  }
  const params = { payment_intent: paymentIntentId, amount: Math.round(Number(op.amount) * 100), metadata: { [OP_METADATA_KEY]: op.id } };
  try {
    return await stripe.refunds.create(params, { idempotencyKey: op.idempotencyKey });
  } catch (error: any) {
    if (!isIdempotencyMismatch(error)) throw error;
    const existing = (await refundAlreadyRecorded(op)) ?? (await findRefundForOp(stripe, paymentIntentId, op));
    if (existing) return existing;
    return await stripe.refunds.create(params, { idempotencyKey: `${op.idempotencyKey}:retagged` });
  }
}

export type RefundResult = {
  refundId: string;
  amount: number;
  kind: RefundKind;
  /** True when this call completed an EARLIER refund whose bookkeeping had
   *  failed, rather than issuing the one that was asked for. */
  reconciled: boolean;
};

/**
 * Issue (or finish) a refund on a retail order, in three steps:
 *
 *  1. Under the order lock: if a refund is still pending — it reached (or may
 *     have reached) Stripe but was never settled here — take THAT one, whatever
 *     kind was asked for. Otherwise validate the request against the row as it
 *     is right now (the overpayment, or the deposit amount) and record a new
 *     operation with a fresh idempotency key. The partial unique index allows
 *     one pending operation per order.
 *  2. Call Stripe with the operation's key: the same key always yields the
 *     same refund, so a retry can't pay twice. A definite rejection (bad
 *     request — no such charge, amount too large) marks the operation failed
 *     so it doesn't block the order; anything ambiguous leaves it pending.
 *  3. Under the order lock again: settle the operation exactly once and move
 *     the paid amount down by its amount (a deposit refund also stamps
 *     depositRefundedAt).
 */
export async function runRetailRefund(stripe: RefundGateway, orderId: string, kind: RefundKind, byUserId: string | null): Promise<RefundResult> {
  const op = await db.transaction(async (tx) => {
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

    const [pending] = await tx
      .select()
      .from(retailOrderRefunds)
      .where(and(eq(retailOrderRefunds.orderId, orderId), eq(retailOrderRefunds.status, "pending")));
    if (pending) return { row: pending, paymentIntentId: order.stripePaymentIntentId, reconciled: true };

    let amount: number;
    if (kind === "overpayment") {
      amount = overpaidAmount(order);
      if (amount <= 0) throw new OrderEditError(400, "Nothing to refund — the customer hasn't overpaid");
    } else {
      if (order.depositRefundedAt) throw new OrderEditError(400, "Deposit has already been refunded");
      amount = money(Number(order.depositAmount ?? 0));
      if (amount <= 0) throw new OrderEditError(400, "No deposit to refund for this order");
    }
    const [row] = await tx
      .insert(retailOrderRefunds)
      .values({ orderId, kind, amount: amount.toFixed(2), idempotencyKey: `retail-refund:${orderId}:${randomUUID()}`, createdByUserId: byUserId })
      .returning();
    return { row, paymentIntentId: order.stripePaymentIntentId, reconciled: false };
  });

  const amount = Number(op.row.amount);
  let refund: { id: string } | null = null;
  try {
    refund = await issueOrFindRefund(stripe, op.paymentIntentId, op.row, op.reconciled);
  } catch (error: any) {
    if (error?.type === "StripeInvalidRequestError") {
      await db.update(retailOrderRefunds).set({ status: "failed", completedAt: new Date() }).where(eq(retailOrderRefunds.id, op.row.id));
    }
    throw error;
  }

  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(retailOrders).where(eq(retailOrders.id, orderId)).for("update");
    const refundId = refund!.id;
    const [settled] = await tx
      .update(retailOrderRefunds)
      .set({ status: "done", stripeRefundId: refundId, completedAt: new Date() })
      .where(and(eq(retailOrderRefunds.id, op.row.id), eq(retailOrderRefunds.status, "pending")))
      .returning();
    if (!settled || !order) return; // a concurrent call settled it first
    const patch: Partial<typeof retailOrders.$inferInsert> = {
      amountPaid: Math.max(0, money(effectiveAmountPaid(order) - amount)).toFixed(2),
      updatedAt: new Date(),
    };
    if (op.row.kind === "deposit") {
      patch.depositRefundedAt = new Date();
      patch.depositRefundedByUserId = byUserId;
    } else {
      patch.notes = `${order.notes ? order.notes + " — " : ""}Refunded $${amount.toFixed(2)} difference after edit (${new Date().toLocaleDateString("en-US")})`;
    }
    await tx.update(retailOrders).set(patch).where(eq(retailOrders.id, orderId));
    console.log(`[RETAIL REFUND] ${op.row.kind} $${amount.toFixed(2)} on ${order.orderNumber}: ${refundId}${op.reconciled ? " (reconciled)" : ""}`);
  });

  return { refundId: refund!.id, amount, kind: op.row.kind as RefundKind, reconciled: op.reconciled };
}
