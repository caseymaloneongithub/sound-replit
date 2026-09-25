/**
 * Raw-material stock levels (owner, 2026-09-23). Order now on EITHER of two
 * criteria; Watch from usage and lead time:
 *
 *   Order now   stock at or below daily usage × supplier lead time × 1.25
 *               ("won't last through the lead time plus a 25% buffer"), OR
 *               stock at or below 15% of the reorder size — the amount a new
 *               order brings in. The prediction leads; the reorder-size floor
 *               is a failsafe for what it can miss: materials are used in
 *               whole batches, so a daily average can say "9 days left" when
 *               one batch needs more than is on hand. (Owner: 25% at first,
 *               then "make our floor 15% of reorder just as a failsafe to take
 *               better advantage of the prediction model".)
 *   Watch       stock up to 1.5 × the lead-time level.
 *   Healthy     anything above.
 *   No recent use   not used in the last 90 days and above the reorder-size
 *               floor — nothing to measure it against.
 *
 * Daily usage (usageRate below; owner: "only account for the time in which that
 * material has been used and weight recent activity (last 30/60/90 days if we
 * have it) higher"):
 *   - history starts at the material's first recorded use, so something first
 *     used 12 days ago (the cans) is averaged over 12 days, not 90;
 *   - the rate is the average of the daily rates over the last 30, 60 and 90
 *     days, each window cut back to the days since the first use. Recent days
 *     fall in every window, so they count most: with 90+ days of history the
 *     last 30 days carry about 60% of the estimate, with 45 days about 83%.
 *     Steady use reads the same in every window, so it still comes out exact;
 *   - a window that reaches back past the first use already holds everything
 *     used, so longer windows would only repeat it and are left out. Under 30
 *     days of history, the rate is simply everything used ÷ the days since the
 *     first use (at least 7, so one batch yesterday isn't read as a daily rate).
 *
 * This is the ONE definition: the inventory dashboard, the Materials table and
 * the stock emails all get their levels from the server's getMaterialLevels(),
 * which applies usageRate() and materialLevel() below.
 */
import { PICKUP_POLICY } from "./pickup-policy";

/** The windows blended into the rate, shortest (most recent) first. */
export const USAGE_WINDOWS = [30, 60, 90] as const;
/** A history shorter than this is averaged over this many days. */
export const MIN_HISTORY_DAYS = 7;
export const SAFETY_BUFFER = 1.25;
export const WATCH_MULTIPLIER = 1.5;
/** The failsafe floor: Order now at or below this share of the reorder size (a new order's amount). */
export const ORDER_NOW_SHARE_OF_REORDER = 0.15;
/** Lead time for a material with no supplier on file. */
export const DEFAULT_LEAD_TIME_DAYS = 14;

export type MaterialLevelKey = "order-now" | "watch" | "healthy" | "no-usage";

export const MATERIAL_LEVEL_LABELS: Record<MaterialLevelKey, string> = {
  "order-now": "Order now",
  watch: "Watch",
  healthy: "Healthy",
  "no-usage": "No recent use",
};

/** Which criterion put a material at Order now. */
export type OrderNowReason = "lead-time" | "reorder-size";

export const ORDER_NOW_REASON_LABELS: Record<OrderNowReason, string> = {
  "lead-time": "Won't last the lead time",
  "reorder-size": `At ${Math.round(ORDER_NOW_SHARE_OF_REORDER * 100)}% of reorder size or less`,
};

export type MaterialLevel = {
  key: MaterialLevelKey;
  /** Average units used per day over the usage window. */
  dailyUsage: number;
  leadTimeDays: number;
  /** Stock at or below this is Order now: the higher of the two criteria. Null when neither applies. */
  orderNowAt: number | null;
  /** The lead-time criterion alone (null without recent usage). */
  leadTimeOrderNowAt: number | null;
  /** The reorder-size criterion alone (null without a reorder size). */
  reorderSizeOrderNowAt: number | null;
  /** Stock at or below this is Watch: 1.5 × the lead-time level. Null without recent usage. */
  watchAt: number | null;
  /** How many days the stock on hand lasts at the average rate; null without recent usage. */
  daysOfCover: number | null;
  /** The criteria that put it at Order now; empty at any other level. */
  orderNowReasons: OrderNowReason[];
};

export function materialLevel(stock: number, dailyUsage: number, leadTimeDays: number, orderSize: number): MaterialLevel {
  const hasUsage = dailyUsage > 0;
  const leadTimeOrderNowAt = hasUsage ? dailyUsage * leadTimeDays * SAFETY_BUFFER : null;
  const reorderSizeOrderNowAt = orderSize > 0 ? orderSize * ORDER_NOW_SHARE_OF_REORDER : null;
  const watchAt = leadTimeOrderNowAt === null ? null : leadTimeOrderNowAt * WATCH_MULTIPLIER;
  const orderNowAt = leadTimeOrderNowAt === null && reorderSizeOrderNowAt === null
    ? null
    : Math.max(leadTimeOrderNowAt ?? -Infinity, reorderSizeOrderNowAt ?? -Infinity);

  const orderNowReasons: OrderNowReason[] = [];
  if (leadTimeOrderNowAt !== null && stock <= leadTimeOrderNowAt) orderNowReasons.push("lead-time");
  if (reorderSizeOrderNowAt !== null && stock <= reorderSizeOrderNowAt) orderNowReasons.push("reorder-size");

  const key: MaterialLevelKey = orderNowReasons.length > 0
    ? "order-now"
    : watchAt !== null && stock <= watchAt
      ? "watch"
      : hasUsage
        ? "healthy"
        : "no-usage";

  return {
    key,
    dailyUsage: hasUsage ? dailyUsage : 0,
    leadTimeDays,
    orderNowAt,
    leadTimeOrderNowAt,
    reorderSizeOrderNowAt,
    watchAt,
    daysOfCover: hasUsage ? stock / dailyUsage : null,
    orderNowReasons,
  };
}

/**
 * Units used per day, recency-weighted, counting only the time since the
 * material was first used (see the header comment).
 *
 * @param historyDays days since the material's first recorded use (null = never used)
 * @param used amounts used over the last 30, 60 and 90 days
 */
export function usageRate(historyDays: number | null, used: { 30: number; 60: number; 90: number }): number {
  if (historyDays === null) return 0;
  const days = Math.max(historyDays, MIN_HISTORY_DAYS);
  const rates: number[] = [];
  for (const w of USAGE_WINDOWS) {
    // Over no more days than the material has been in use.
    rates.push(used[w] / Math.min(w, days));
    // This window already reaches back to the first use; longer ones would repeat it.
    if (w >= days) break;
  }
  return rates.reduce((sum, r) => sum + r, 0) / rates.length;
}

/** How much to order: the material's reorder size, or 30 days of use when none is set. */
export function suggestedOrderQty(orderSize: number, dailyUsage: number): number {
  return orderSize > 0 ? orderSize : Math.ceil(dailyUsage * 30);
}

// ---- Open purchase orders (owner, 2026-09-24: "some sort of indicator of
// whether outstanding purchase orders of materials will satisfy any shortfalls
// in inventory, while still differentiating from actual inventory" …
// "something communicating that we're good pending delivery"). What's on order
// is shown BESIDE a material's level, never folded into it: the level and the
// stock on hand stay what's actually on the shelf. ----

/**
 * A material's open purchase orders: units on lines not yet marked received,
 * and when they're due — each order's date plus that PO supplier's lead time.
 */
export type OnOrder = {
  units: number;
  /** ISO timestamps: when the soonest line is due, and the last. */
  firstDue: string;
  lastDue: string;
};

export type OrderCoverageKey = "covered" | "runs-out-first" | "short" | "not-short";

export const ORDER_COVERAGE_LABELS: Record<OrderCoverageKey, string> = {
  covered: "Covered, pending delivery",
  "runs-out-first": "On order, may run out first",
  short: "On order, not enough",
  "not-short": "On order",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a material's open purchase orders take care of its shortfall:
 *
 *   not-short       it's healthy (or has no recent use) already; the order is just noted
 *   covered         once everything on order has arrived it's healthy again, and
 *                   the stock on hand lasts until the first delivery is due
 *   runs-out-first  enough is coming, but the stock on hand runs out before the
 *                   first delivery is due
 *   short           still at Watch or Order now after everything has arrived
 *
 * "After everything has arrived" allows for what's used until the last
 * delivery is due. Overdue lines count as due now.
 */
export function orderCoverage(
  stock: number,
  dailyUsage: number,
  leadTimeDays: number,
  orderSize: number,
  onOrder: OnOrder,
  now: Date = new Date(),
): OrderCoverageKey {
  const today = materialLevel(stock, dailyUsage, leadTimeDays, orderSize).key;
  if (today === "healthy" || today === "no-usage") return "not-short";
  const daysUntil = (iso: string) => Math.max(0, (Date.parse(iso) - now.getTime()) / DAY_MS);
  const onHandWhenLastArrives = Math.max(0, stock - dailyUsage * daysUntil(onOrder.lastDue));
  const afterDelivery = materialLevel(onHandWhenLastArrives + onOrder.units, dailyUsage, leadTimeDays, orderSize).key;
  if (afterDelivery === "order-now" || afterDelivery === "watch") return "short";
  return dailyUsage > 0 && stock / dailyUsage < daysUntil(onOrder.firstDue) ? "runs-out-first" : "covered";
}

/**
 * When an order is due, in the brewery's time zone: "due Oct 3", "due Oct 3–10",
 * "due Sep 27–Oct 3", "due Sep 20, overdue", "due Sep 18, 2025–Oct 3, some
 * overdue". A year shows only when it isn't this one.
 */
export function onOrderDueText(onOrder: OnOrder, now: Date = new Date()): string {
  const parts = (at: Date) => {
    const p = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: PICKUP_POLICY.timezone }).formatToParts(at);
    const get = (type: string) => p.find((x) => x.type === type)?.value ?? "";
    return { year: get("year"), month: get("month"), day: get("day") };
  };
  const thisYear = parts(now).year;
  const first = parts(new Date(onOrder.firstDue));
  const last = parts(new Date(onOrder.lastDue));
  const year = (d: { year: string }) => (d.year !== thisYear ? `, ${d.year}` : "");
  const full = (d: { year: string; month: string; day: string }) => `${d.month} ${d.day}${year(d)}`;
  const range = first.year === last.year && first.month === last.month
    ? (first.day === last.day ? full(first) : `${first.month} ${first.day}–${last.day}${year(first)}`)
    : `${full(first)}–${full(last)}`;
  const overdue = Date.parse(onOrder.lastDue) < now.getTime() ? ", overdue"
    : Date.parse(onOrder.firstDue) < now.getTime() ? ", some overdue" : "";
  return `due ${range}${overdue}`;
}
