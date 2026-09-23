import { queryClient } from "./queryClient";

/**
 * Every screen that shows raw-material stock or stock levels: the Materials
 * list and the inventory dashboard's panels (reorder alerts, production limits,
 * cost of goods, finished goods). The server works the levels out fresh on every
 * read, so after anything that changes stock, usage, a recipe, a supplier's lead
 * time or a material, marking these stale is all it takes for them to refresh
 * right away (owner, 2026-09-23). Without it a screen fetched in the last 30
 * seconds kept showing the old numbers (review: a supplier's lead time went
 * from 2 to 14 days and Materials still said Healthy).
 */
const STOCK_VIEWS = [
  "/api/materials",
  "/api/inventory/dashboard",
  "/api/inventory/reorder-report",
  "/api/inventory/limit-report",
  "/api/inventory/cogs-report",
  "/api/inventory/finished-goods",
] as const;

export function refreshStockViews(): void {
  for (const key of STOCK_VIEWS) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}
