/**
 * Weekly profitability projection, admin-and-up (owner, 2026-11-15; see
 * shared/profitability.ts for the arithmetic). This module prices the product
 * from the recipes, averages recent orders into a starting point, and keeps the
 * owner's saved scenarios.
 *
 * Costs: each flavor's Brew recipe prices a gallon of kombucha (its lines are
 * per gallon, with the materials' own waste rates on top, as cost of goods
 * counts them); its Can recipe prices a case's packaging. Where a flavor has
 * more than one of either, the newest active one speaks. Flavors are weighted
 * by their share of recent sales, by volume of kombucha, or evenly.
 *
 * Scenarios live in site_settings under one key as JSON: a handful of named
 * input sets for one or two admins, not a table's worth.
 */
import type { Express } from "express";
import crypto from "crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { siteSettings } from "@shared/schema";
import {
  CHANNELS,
  GALLONS_PER_CASE,
  GALLONS_PER_KEG,
  projectionInputsSchema,
  type CatalogPrices,
  type Channel,
  type ChannelActuals,
  type FlavorCost,
  type ProjectionActuals,
  type ProjectionBasis,
  type ProjectionInputs,
} from "@shared/profitability";

type Handler = (req: any, res: any, next: any) => any;
type Deps = { isAuthenticated: Handler; isAdmin: Handler };

const ACTUALS_WEEKS = 8;
const SCENARIOS_KEY = "profitability_scenarios";
const MAX_SCENARIOS = 25;
/** A bottle case's kombucha, for weighting flavors while the last bottles sell through. */
const GALLONS_PER_BOTTLE_CASE = 1.5;

export type StoredScenario = {
  id: string;
  name: string;
  inputs: ProjectionInputs;
  updatedAt: string;
  updatedBy: string | null;
};

const isGallons = (unit: string | null | undefined) => /^gal/i.test(String(unit ?? "").trim());

type RecipeLineRow = {
  process_id: string;
  title: string;
  unit: string;
  flavor_id: string;
  flavor: string;
  container: string | null;
  created_at: string;
  material_unit: string;
  line_cost: number;
};

/** Every flavor's cost per gallon (Brew) and packaging per case (Can), from the active recipes. */
async function recipeCosts(): Promise<{ flavors: Map<string, { name: string; brew: number | null; can: number | null }>; notes: string[] }> {
  const { rows } = await db.execute(sql`
    SELECT p.id AS process_id, p.title, p.unit, p.flavor_id, f.name AS flavor, fp.container,
           p.created_at::text AS created_at, m.unit AS material_unit,
           (pm.units * (1 + m.waste_rate / 100) * m.cost)::float8 AS line_cost
    FROM processes p
    JOIN flavors f ON f.id = p.flavor_id
    LEFT JOIN products fp ON fp.id = p.finished_product_id
    JOIN process_materials pm ON pm.process_id = p.id
    JOIN materials m ON m.id = pm.material_id AND m.deleted_at IS NULL
    WHERE p.deleted_at IS NULL AND p.is_active`);
  const lines = rows as unknown as RecipeLineRow[];

  type Recipe = { title: string; unit: string; flavorId: string; flavor: string; container: string | null; createdAt: string; cost: number; liquidLinesSkipped: number };
  const recipes = new Map<string, Recipe>();
  for (const l of lines) {
    const r = recipes.get(l.process_id) ?? {
      title: l.title, unit: l.unit, flavorId: l.flavor_id, flavor: l.flavor, container: l.container, createdAt: l.created_at, cost: 0, liquidLinesSkipped: 0,
    };
    const isCanRecipe = /^can\b/i.test(r.title) || r.container === "can-case";
    // A Can recipe's packaging is cans, ends, boxes and stickers; kombucha is priced by the Brew recipe, so a liquid line here would count it twice.
    if (isCanRecipe && isGallons(l.material_unit)) r.liquidLinesSkipped += 1;
    else r.cost += Number(l.line_cost) || 0;
    recipes.set(l.process_id, r);
  }

  const notes: string[] = [];
  type FlavorEntry = { name: string; brew: number | null; can: number | null; brewAt?: string; canAt?: string };
  const flavors = new Map<string, FlavorEntry>();
  const newest = (a: string | undefined, b: string) => !a || b > a;
  for (const r of Array.from(recipes.values())) {
    const entry: FlavorEntry = flavors.get(r.flavorId) ?? { name: r.flavor, brew: null, can: null };
    const isBrew = /^brew\b/i.test(r.title) || isGallons(r.unit);
    const isCan = /^can\b/i.test(r.title) || r.container === "can-case";
    if (isBrew) {
      if (!isGallons(r.unit)) {
        notes.push(`${r.title} is priced per ${r.unit}, not per gallon, so it isn't used.`);
      } else if (newest(entry.brewAt, r.createdAt)) {
        entry.brew = r.cost;
        entry.brewAt = r.createdAt;
      }
    } else if (isCan) {
      if (newest(entry.canAt, r.createdAt)) {
        entry.can = r.cost;
        entry.canAt = r.createdAt;
      }
    }
    flavors.set(r.flavorId, entry);
  }
  return { flavors, notes };
}

/** Gallons of kombucha each flavor sold in the window, over every channel and package. */
async function flavorGallons(since: Date): Promise<Map<string, number>> {
  const keg = sql.raw(String(GALLONS_PER_KEG));
  const canCase = sql.raw(String(GALLONS_PER_CASE));
  const bottleCase = sql.raw(String(GALLONS_PER_BOTTLE_CASE));
  const { rows } = await db.execute(sql`
    WITH ws AS (
      SELECT oi.flavor_id,
             SUM(oi.quantity * CASE wut.container WHEN 'keg-sixth' THEN ${keg} WHEN 'bottle-case' THEN ${bottleCase} ELSE ${canCase} END)::float8 AS gallons
      FROM wholesale_order_items oi
      JOIN wholesale_orders o ON o.id = oi.order_id
      JOIN wholesale_unit_types wut ON wut.id = oi.unit_type_id
      WHERE o.deleted_at IS NULL AND o.status <> 'cancelled' AND o.order_date >= ${since} AND oi.flavor_id IS NOT NULL
      GROUP BY 1),
    rt AS (
      SELECT i.selected_flavor_id AS flavor_id,
             SUM(i.quantity * CASE WHEN rp.unit_type ILIKE '%keg%' THEN ${keg} WHEN rp.unit_description ILIKE '%bottle%' THEN ${bottleCase} ELSE ${canCase} END)::float8 AS gallons
      FROM retail_order_items_v2 i
      JOIN retail_orders o ON o.id = i.order_id
      JOIN retail_products rp ON rp.id = i.retail_product_id
      WHERE o.deleted_at IS NULL AND o.status <> 'cancelled' AND o.order_date >= ${since} AND i.selected_flavor_id IS NOT NULL
      GROUP BY 1)
    SELECT flavor_id, SUM(gallons)::float8 AS gallons
    FROM (SELECT * FROM ws UNION ALL SELECT * FROM rt) u
    GROUP BY 1`);
  return new Map((rows as unknown as { flavor_id: string; gallons: number }[]).map((r) => [r.flavor_id, Number(r.gallons) || 0]));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Weighted by the weights where they sum to something, else evenly. */
function weighted(items: Array<{ value: number; weight: number }>): number {
  const total = items.reduce((s, i) => s + i.weight, 0);
  if (total <= 0) return mean(items.map((i) => i.value));
  return items.reduce((s, i) => s + i.value * (i.weight / total), 0);
}

export async function buildBasis(since: Date): Promise<ProjectionBasis> {
  const [{ flavors, notes }, gallons] = await Promise.all([recipeCosts(), flavorGallons(since)]);

  const brewFlavors = Array.from(flavors.entries()).filter(([, f]) => f.brew !== null);
  const brewGallons = brewFlavors.reduce((s, [id]) => s + (gallons.get(id) ?? 0), 0);
  const list: FlavorCost[] = Array.from(flavors.entries())
    .map(([flavorId, f]) => ({
      flavorId,
      name: f.name,
      ingredientPerGallon: f.brew,
      packagingPerCase: f.can,
      salesWeight: f.brew !== null && brewGallons > 0 ? (gallons.get(flavorId) ?? 0) / brewGallons : 0,
    }))
    .sort((a, b) => b.salesWeight - a.salesWeight || a.name.localeCompare(b.name));

  const brewItems = list.filter((f) => f.ingredientPerGallon !== null).map((f) => ({ value: f.ingredientPerGallon as number, weight: gallons.get(f.flavorId) ?? 0 }));
  const canItems = list.filter((f) => f.packagingPerCase !== null).map((f) => ({ value: f.packagingPerCase as number, weight: gallons.get(f.flavorId) ?? 0 }));
  if (brewItems.length === 0) notes.push("No active Brew recipe prices a gallon of kombucha, so ingredient costs are zero.");
  if (canItems.length === 0) notes.push("No active Can recipe prices a case's packaging, so packaging costs are zero.");
  for (const f of list) {
    if (f.ingredientPerGallon !== null && f.packagingPerCase === null) notes.push(`${f.name} has a Brew recipe but no Can recipe.`);
    if (f.ingredientPerGallon === null && f.packagingPerCase !== null) notes.push(`${f.name} has a Can recipe but no Brew recipe.`);
  }

  return {
    flavors: list,
    ingredientPerGallon: { sales: weighted(brewItems), even: mean(brewItems.map((i) => i.value)) },
    packagingPerCase: { sales: weighted(canItems), even: mean(canItems.map((i) => i.value)) },
    notes,
  };
}

type VolumeRow = { channel: Channel; container: string; units: number; revenue: number };

/** Recent orders averaged per week by channel. The distributor is any account named as one (Pearl Distributing). */
export async function recentActuals(since: Date, weeks: number): Promise<ProjectionActuals> {
  const wholesale = await db.execute(sql`
    SELECT CASE WHEN c.business_name ILIKE '%distribut%' THEN 'distributor' ELSE 'wholesale' END AS channel,
           wut.container, SUM(oi.quantity)::float8 AS units, SUM(oi.quantity * oi.unit_price)::float8 AS revenue
    FROM wholesale_order_items oi
    JOIN wholesale_orders o ON o.id = oi.order_id
    JOIN wholesale_customers c ON c.id = o.customer_id
    JOIN wholesale_unit_types wut ON wut.id = oi.unit_type_id
    WHERE o.deleted_at IS NULL AND o.status <> 'cancelled' AND o.order_date >= ${since}
      AND wut.container IN ('can-case', 'keg-sixth')
    GROUP BY 1, 2`);
  const retail = await db.execute(sql`
    SELECT 'retail' AS channel,
           CASE WHEN rp.unit_type ILIKE '%keg%' THEN 'keg-sixth' WHEN rp.unit_description ILIKE '%can%' THEN 'can-case' END AS container,
           SUM(i.quantity)::float8 AS units, SUM(i.quantity * i.unit_price)::float8 AS revenue
    FROM retail_order_items_v2 i
    JOIN retail_orders o ON o.id = i.order_id
    JOIN retail_products rp ON rp.id = i.retail_product_id
    WHERE o.deleted_at IS NULL AND o.status <> 'cancelled' AND o.order_date >= ${since}
    GROUP BY 1, 2`);
  const rows = [...(wholesale.rows as unknown as VolumeRow[]), ...(retail.rows as unknown as VolumeRow[])];

  const empty = (): ChannelActuals => ({ casesPerWeek: 0, casePrice: null, kegsPerWeek: 0, kegPrice: null });
  const channels = { distributor: empty(), wholesale: empty(), retail: empty() } as Record<Channel, ChannelActuals>;
  for (const r of rows) {
    if (!CHANNELS.includes(r.channel)) continue;
    const units = Number(r.units) || 0;
    const price = units > 0 ? (Number(r.revenue) || 0) / units : null;
    if (r.container === "can-case") {
      channels[r.channel].casesPerWeek = units / weeks;
      channels[r.channel].casePrice = price;
    } else if (r.container === "keg-sixth") {
      channels[r.channel].kegsPerWeek = units / weeks;
      channels[r.channel].kegPrice = price;
    }
  }
  return { weeks, since: since.toISOString(), channels };
}

/** List prices from the catalog: the wholesale unit types and the retail products. The distributor has no list price. */
export async function catalogPrices(): Promise<CatalogPrices> {
  const ws = await db.execute(sql`
    SELECT container, default_price::float8 AS price FROM wholesale_unit_types
    WHERE is_active AND container IN ('can-case', 'keg-sixth') ORDER BY display_order`);
  const rt = await db.execute(sql`
    SELECT unit_type, unit_description, price::float8 AS price FROM retail_products
    WHERE is_active ORDER BY display_order, price`);
  const wsRows = ws.rows as unknown as { container: string; price: number }[];
  const rtRows = rt.rows as unknown as { unit_type: string; unit_description: string; price: number }[];
  const wsCase = wsRows.find((r) => r.container === "can-case")?.price ?? null;
  const wsKeg = wsRows.find((r) => r.container === "keg-sixth")?.price ?? null;
  const rtCase = rtRows.find((r) => /case/i.test(r.unit_type) && /can/i.test(r.unit_description))?.price ?? null;
  const rtKeg = rtRows.find((r) => /keg/i.test(r.unit_type))?.price ?? null;
  return {
    casePrice: { distributor: null, wholesale: wsCase, retail: rtCase },
    kegPrice: { distributor: null, wholesale: wsKeg, retail: rtKeg },
  };
}

async function readScenarios(): Promise<StoredScenario[]> {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, SCENARIOS_KEY));
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? (parsed as StoredScenario[]) : [];
  } catch {
    return [];
  }
}

async function writeScenarios(list: StoredScenario[]): Promise<void> {
  const value = JSON.stringify(list);
  await db
    .insert(siteSettings)
    .values({ key: SCENARIOS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value, updatedAt: new Date() } });
}

const saveScenarioSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give the scenario a name").max(60),
  inputs: projectionInputsSchema,
});

export function registerProfitabilityRoutes(app: Express, deps: Deps) {
  const { isAuthenticated, isAdmin } = deps;

  app.get("/api/profitability/basis", isAuthenticated, isAdmin, async (_req, res) => {
    try {
      const since = new Date(Date.now() - ACTUALS_WEEKS * 7 * 24 * 60 * 60 * 1000);
      const [basis, actuals, catalog] = await Promise.all([buildBasis(since), recentActuals(since, ACTUALS_WEEKS), catalogPrices()]);
      res.json({ basis, actuals, catalog });
    } catch (error: any) {
      console.error("[PROFITABILITY] basis failed:", error);
      res.status(500).json({ message: "Couldn't price the recipes: " + error.message });
    }
  });

  app.get("/api/profitability/scenarios", isAuthenticated, isAdmin, async (_req, res) => {
    try {
      res.json(await readScenarios());
    } catch (error: any) {
      res.status(500).json({ message: "Couldn't load scenarios: " + error.message });
    }
  });

  // One scenario saved, new or over its earlier self.
  app.post("/api/profitability/scenarios", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const parsed = saveScenarioSchema.safeParse(req.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return res.status(400).json({ message: issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid scenario" });
      }
      const list = await readScenarios();
      const now = new Date().toISOString();
      const existing = parsed.data.id ? list.find((s) => s.id === parsed.data.id) : undefined;
      const saved: StoredScenario = {
        id: existing?.id ?? crypto.randomUUID(),
        name: parsed.data.name,
        inputs: parsed.data.inputs,
        updatedAt: now,
        updatedBy: (req as any).user?.id ?? null,
      };
      const next = existing ? list.map((s) => (s.id === saved.id ? saved : s)) : [...list, saved];
      if (next.length > MAX_SCENARIOS) {
        return res.status(400).json({ message: `Keep it to ${MAX_SCENARIOS} scenarios — delete one first.` });
      }
      await writeScenarios(next);
      res.json(saved);
    } catch (error: any) {
      res.status(500).json({ message: "Couldn't save the scenario: " + error.message });
    }
  });

  app.delete("/api/profitability/scenarios/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const list = await readScenarios();
      const next = list.filter((s) => s.id !== req.params.id);
      if (next.length === list.length) return res.status(404).json({ message: "Scenario not found" });
      await writeScenarios(next);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Couldn't delete the scenario: " + error.message });
    }
  });
}
