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
 * and when each is due — its order's date plus that PO supplier's lead time.
 *
 * Dates are calendar dates ("2026-09-30"), the way a purchase order's date is
 * entered: the day picked on the form, stored as midnight UTC. Read as an
 * instant, that midnight is the afternoon before in Pacific time, and a due
 * date showed (and went overdue) a day early (review, 2026-09-24).
 */
export type OnOrder = {
  units: number;
  /** The soonest and the last due date, for display. */
  firstDue: string;
  lastDue: string;
  /** Each open line: how much, and the calendar date it's due. */
  deliveries: Array<{ units: number; due: string }>;
};

export type OrderCoverageKey = "covered" | "runs-out-first" | "short" | "not-short";

export const ORDER_COVERAGE_LABELS: Record<OrderCoverageKey, string> = {
  covered: "Covered, pending delivery",
  "runs-out-first": "On order, may run out first",
  short: "On order, not enough",
  "not-short": "On order",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today's calendar date at the brewery, "2026-09-24", whatever time zone the server runs in. */
export function breweryToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: PICKUP_POLICY.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Whole days from one calendar date to another. */
function daysFrom(from: string, to: string): number {
  const day = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY_MS;
  return day(to) - day(from);
}

/**
 * Whether a material's open purchase orders take care of its shortfall:
 *
 *   not-short       it's healthy (or has no recent use) already; the order is just noted
 *   covered         once everything on order has arrived it's healthy, and it
 *                   never runs dry waiting for a delivery
 *   runs-out-first  it ends up healthy, but runs dry before a delivery arrives
 *   short           still at Watch or Order now once everything has arrived
 *
 * Worked out as a running balance, delivery by delivery in due order: the
 * stock is used at the daily rate until each delivery's due day (an overdue
 * one, today), can't go below nothing, and then takes the delivery. Judging
 * the total against the last due date alone let an early delivery that's used
 * up before a small late one read as covered, and checking only the first
 * delivery missed running dry between two (review, 2026-09-24).
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
  const todayDate = breweryToday(now);
  const arrivals = onOrder.deliveries
    .map((d) => ({ units: d.units, day: Math.max(0, daysFrom(todayDate, d.due)) }))
    .sort((a, b) => a.day - b.day);
  let onHand = stock;
  let day = 0;
  let runsDry = false;
  for (const arrival of arrivals) {
    onHand -= dailyUsage * (arrival.day - day);
    if (onHand < 0) {
      runsDry = true;
      onHand = 0;
    }
    onHand += arrival.units;
    day = arrival.day;
  }
  const afterDeliveries = materialLevel(onHand, dailyUsage, leadTimeDays, orderSize).key;
  if (afterDeliveries === "order-now" || afterDeliveries === "watch") return "short";
  return runsDry ? "runs-out-first" : "covered";
}

/**
 * When an order is due: "due Sep 30", "due Oct 3–10", "due Sep 27–Oct 3", "due
 * Sep 20, overdue", "due Sep 18, 2025–Oct 3, some overdue". Calendar dates as
 * entered, compared with today at the brewery; a year shows only when it isn't
 * this one.
 */
export function onOrderDueText(onOrder: OnOrder, now: Date = new Date()): string {
  const today = breweryToday(now);
  const thisYear = today.slice(0, 4);
  const parts = (d: string) => ({ year: d.slice(0, 4), month: MONTHS[Number(d.slice(5, 7)) - 1], day: String(Number(d.slice(8, 10))) });
  const first = parts(onOrder.firstDue);
  const last = parts(onOrder.lastDue);
  const year = (d: { year: string }) => (d.year !== thisYear ? `, ${d.year}` : "");
  const full = (d: { year: string; month: string; day: string }) => `${d.month} ${d.day}${year(d)}`;
  const range = first.year === last.year && first.month === last.month
    ? (first.day === last.day ? full(first) : `${first.month} ${first.day}–${last.day}${year(first)}`)
    : `${full(first)}–${full(last)}`;
  const overdue = onOrder.lastDue < today ? ", overdue" : onOrder.firstDue < today ? ", some overdue" : "";
  return `due ${range}${overdue}`;
}
