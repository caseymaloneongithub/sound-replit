/**
 * Raw-material stock levels, from recent usage and the supplier's lead time
 * (owner, 2026-09-23: "order now as stock at or below daily usage × lead time ×
 * 1.25, a 25% safety buffer, and watch as that times 1.5. Be consistent
 * throughout dashboard, table, and email notification").
 *
 *   order-now level = daily usage × supplier lead time × 1.25
 *   watch level     = order-now level × 1.5
 *
 *   stock at or below the order-now level    Order now
 *   stock at or below the watch level        Watch
 *   anything above                           Healthy
 *   not used in the last 90 days             No recent use (nothing to measure against)
 *
 * This is the ONE definition: the inventory dashboard, the Materials table and
 * the stock emails all get their levels from the server's getMaterialLevels(),
 * which applies materialLevel() below. The reorder size is only how much to
 * order; it plays no part in the status.
 */
export const USAGE_WINDOW_DAYS = 90;
export const SAFETY_BUFFER = 1.25;
export const WATCH_MULTIPLIER = 1.5;
/** Lead time for a material with no supplier on file. */
export const DEFAULT_LEAD_TIME_DAYS = 14;

export type MaterialLevelKey = "order-now" | "watch" | "healthy" | "no-usage";

export const MATERIAL_LEVEL_LABELS: Record<MaterialLevelKey, string> = {
  "order-now": "Order now",
  watch: "Watch",
  healthy: "Healthy",
  "no-usage": "No recent use",
};

export type MaterialLevel = {
  key: MaterialLevelKey;
  /** Average units used per day over the usage window. */
  dailyUsage: number;
  leadTimeDays: number;
  /** Stock at or below this is Order now; null when there's no usage. */
  orderNowAt: number | null;
  /** Stock at or below this is Watch; null when there's no usage. */
  watchAt: number | null;
  /** How many days the stock on hand lasts at the current rate; null with no usage. */
  daysOfCover: number | null;
};

export function materialLevel(stock: number, dailyUsage: number, leadTimeDays: number): MaterialLevel {
  if (!(dailyUsage > 0)) {
    return { key: "no-usage", dailyUsage: 0, leadTimeDays, orderNowAt: null, watchAt: null, daysOfCover: null };
  }
  const orderNowAt = dailyUsage * leadTimeDays * SAFETY_BUFFER;
  const watchAt = orderNowAt * WATCH_MULTIPLIER;
  const key: MaterialLevelKey = stock <= orderNowAt ? "order-now" : stock <= watchAt ? "watch" : "healthy";
  return { key, dailyUsage, leadTimeDays, orderNowAt, watchAt, daysOfCover: stock / dailyUsage };
}

/** How much to order: the material's reorder size, or 30 days of use when none is set. */
export function suggestedOrderQty(orderSize: number, dailyUsage: number): number {
  return orderSize > 0 ? orderSize : Math.ceil(dailyUsage * 30);
}
