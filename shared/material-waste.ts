/**
 * Waste (owner, 2026-10-15): "I want to be able to define a waste rate for each
 * material. For example, if I say 2% of cans are wasted, then the inventories and
 * costs reflect that 2% additional usage."
 *
 * Each material carries `wasteRate`, a percentage on top of what its recipes call
 * for: a recipe line of 100 cans on a material with 2% waste draws 102. The rate is
 * applied wherever a recipe line is turned into a quantity, and only there:
 *   - the usage a logged batch records and deducts from stock (storage.createProduction,
 *     in SQL as `pm.units * (1 + m.waste_rate / 100)`, the same arithmetic as below);
 *   - the production-limit report ("can make"), cost of goods, and the cost estimates
 *     on the Recipes and Productions pages.
 * Stock on hand, purchase orders and the inventory value are what is physically
 * there, so they take no waste.
 */

/** The most a waste rate can be, in percent. */
export const MAX_WASTE_RATE = 100;

/** 1 + rate/100: what to multiply a recipe line by. A blank, bad or negative rate counts as none. */
export function wasteMultiplier(wasteRate: string | number | null | undefined): number {
  const pct = typeof wasteRate === "number" ? wasteRate : parseFloat(wasteRate ?? "0");
  return Number.isFinite(pct) && pct > 0 ? 1 + pct / 100 : 1;
}

/** What a recipe line really draws per unit of output: its quantity plus the material's waste. */
export function lineDraw(units: string | number | null | undefined, wasteRate: string | number | null | undefined): number {
  const u = typeof units === "number" ? units : parseFloat(units ?? "0");
  return (Number.isFinite(u) ? u : 0) * wasteMultiplier(wasteRate);
}
