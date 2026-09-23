/**
 * Raw-material stock levels (owner, 2026-09-23). Order now on EITHER of two
 * criteria; Watch from usage and lead time:
 *
 *   Order now   stock at or below daily usage × supplier lead time × 1.25
 *               ("won't last through the lead time plus a 25% buffer"), OR
 *               stock at or below 25% of the reorder size — the amount a new
 *               order brings in. Added because the usage prediction alone read
 *               low stock as fine: materials are used in whole batches, so a
 *               90-day daily average can say "9 days left" when one batch
 *               needs more than is on hand.
 *   Watch       stock up to 1.5 × the lead-time level.
 *   Healthy     anything above.
 *   No recent use   not used in the last 90 days and not under 25% of its
 *               reorder size — nothing to measure it against.
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
/** The windows blended into the rate, shortest (most recent) first. */
export const USAGE_WINDOWS = [30, 60, 90] as const;
/** A history shorter than this is averaged over this many days. */
export const MIN_HISTORY_DAYS = 7;
export const SAFETY_BUFFER = 1.25;
export const WATCH_MULTIPLIER = 1.5;
/** Order now at or below this share of the reorder size (a new order's amount). */
export const ORDER_NOW_SHARE_OF_REORDER = 0.25;
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
