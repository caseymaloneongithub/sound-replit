/**
 * Raw-material stock health: on-hand stock as a share of the material's reorder
 * size (owner, 2026-09-23: "watch at 50% and reorder at 25%"). One definition for
 * the Materials page badges and the server's stock emails, so the two can't
 * disagree about what "watch" or "reorder" means.
 *
 *   above 50%          healthy
 *   25% up to 50%      watch    (admins emailed on the way down)
 *   25% or less        reorder  (admins emailed on the way down)
 *
 * A material with no reorder size has no target, so it has no health.
 */
export const MATERIAL_WATCH_RATIO = 0.5;
export const MATERIAL_REORDER_RATIO = 0.25;

export type MaterialHealthKey = "healthy" | "watch" | "reorder" | "na";

export function materialHealth(stock: number, orderSize: number): { key: MaterialHealthKey; ratio: number | null } {
  if (!(orderSize > 0)) return { key: "na", ratio: null };
  const ratio = stock / orderSize;
  if (ratio <= MATERIAL_REORDER_RATIO) return { key: "reorder", ratio };
  if (ratio <= MATERIAL_WATCH_RATIO) return { key: "watch", ratio };
  return { key: "healthy", ratio };
}
