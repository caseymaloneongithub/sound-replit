/**
 * Migrate the legacy Laravel inventory SQLite DB into the site's Postgres schema.
 *
 * Strategy: FULL MIRROR (idempotent). Each run wipes the 7 inventory tables and
 * reloads them from inventory.db, preserving the legacy integer IDs (as strings)
 * so relationships stay intact and re-running produces the same result. This is a
 * one-way legacy -> new sync: anything created directly in the new system is
 * replaced. Re-run at go-live to capture whatever the legacy site recorded since.
 *
 * Recipes (processes) are auto-linked to the site's `flavors` table by matching the
 * text after the colon in the title (e.g. "Bottle:Sunbreak" -> flavor "Sunbreak").
 *
 * Run:  node --env-file=.env --experimental-sqlite scripts/migrate-inventory.mjs [path-to-sqlite]
 */
import { DatabaseSync } from "node:sqlite";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const SQLITE_PATH = process.argv[2] || "./inventory.db";
const sqlite = new DatabaseSync(SQLITE_PATH);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const all = (sql) => sqlite.prepare(sql).all();
const clean = (v) => (typeof v === "string" ? v.trim() || null : v ?? null);
// Legacy stores some numerics as "" — coerce anything non-numeric to the default.
const num = (v, dflt = 0) => {
  if (v === null || v === undefined || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

async function insertRows(client, table, columns, rows) {
  if (rows.length === 0) return 0;
  const CHUNK = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const valuesSql = chunk
      .map((row) => {
        const ph = row.map((_, j) => `$${params.length + j + 1}`);
        params.push(...row);
        return `(${ph.join(",")})`;
      })
      .join(",");
    await client.query(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES ${valuesSql}`,
      params
    );
    total += chunk.length;
  }
  return total;
}

async function main() {
  // ---- Read legacy data ----
  const legSuppliers = all("SELECT * FROM suppliers");
  const legMaterials = all("SELECT * FROM materials");
  const legProcesses = all("SELECT * FROM processes");
  const legProcMat = all("SELECT * FROM process_material");
  const legProductions = all("SELECT * FROM productions");
  const legOrders = all("SELECT * FROM orders");
  const legOrderMat = all("SELECT * FROM order_material");

  const client = await pool.connect();
  try {
    // ---- SAFETY: refuse to wipe a database the new system has already written to ----
    // Legacy ids are integers-as-strings; anything the new app creates gets a UUID. Once a
    // single UUID exists in these tables, this mirror would destroy real data. After the
    // production cutover this script must never run again — pass --force only if you
    // truly mean to discard everything logged in the new system.
    const probe = await client.query(`
      SELECT count(*)::int AS n FROM (
        SELECT id FROM productions WHERE id !~ '^[0-9]+$'
        UNION ALL SELECT id FROM materials WHERE id !~ '^[0-9]+$'
        UNION ALL SELECT id FROM material_orders WHERE id !~ '^[0-9]+$'
        UNION ALL SELECT id FROM processes WHERE id !~ '^[0-9]+$'
      ) x`);
    if (probe.rows[0].n > 0 && !process.argv.includes('--force')) {
      throw new Error(`Target already contains ${probe.rows[0].n} row(s) created by the new system (non-legacy ids). ` +
        `Mirroring would delete them. Re-run with --force ONLY if you intend to discard new-system inventory data.`);
    }

    // ---- Flavor name -> id map (for linking recipes) ----
    const flavorRes = await client.query("SELECT id, name FROM flavors");
    const flavorMap = new Map(
      flavorRes.rows.map((f) => [String(f.name).toLowerCase(), f.id])
    );

    await client.query("BEGIN");

    // ---- Wipe (children first) ----
    for (const t of [
      "order_materials",
      "material_orders",
      "productions",
      "process_materials",
      "processes",
      "materials",
      "suppliers",
    ]) {
      await client.query(`DELETE FROM ${t}`);
    }

    // ---- Suppliers ----
    const supplierIds = new Set(legSuppliers.map((s) => String(s.id)));
    await insertRows(
      client,
      "suppliers",
      ["id", "name", "website", "email", "lead_time_days", "notes"],
      legSuppliers.map((s) => [
        String(s.id),
        clean(s.name) ?? "(unnamed)",
        clean(s.website),
        clean(s.email),
        num(s.lead_time, 14),
        null,
      ])
    );

    // ---- Materials (null out orphaned supplier refs) ----
    const materialIds = new Set(legMaterials.map((m) => String(m.id)));
    await insertRows(
      client,
      "materials",
      ["id", "title", "unit", "cost", "supplier_id", "order_size", "stock"],
      legMaterials.map((m) => [
        String(m.id),
        clean(m.title) ?? "(untitled)",
        clean(m.unit) ?? "unit",
        num(m.cost),
        supplierIds.has(String(m.supplier_id)) ? String(m.supplier_id) : null,
        num(m.order_size),
        num(m.stock),
      ])
    );

    // ---- Processes (link to flavor by text after the colon) ----
    let flavorLinked = 0;
    const processIds = new Set(legProcesses.map((p) => String(p.id)));
    await insertRows(
      client,
      "processes",
      ["id", "title", "unit", "standard_batch", "flavor_id"],
      legProcesses.map((p) => {
        const title = clean(p.title) ?? "(untitled)";
        const afterColon = title.includes(":")
          ? title.split(":").slice(1).join(":").trim().toLowerCase()
          : null;
        const flavorId = afterColon ? flavorMap.get(afterColon) ?? null : null;
        if (flavorId) flavorLinked++;
        return [String(p.id), title, clean(p.unit) ?? "unit", num(p.standard_batch), flavorId];
      })
    );

    // ---- Process materials (BOM) — skip rows with missing parents (NOT NULL FKs) ----
    let skippedBom = 0;
    const bomRows = legProcMat
      .filter((r) => {
        const ok = processIds.has(String(r.process_id)) && materialIds.has(String(r.material_id));
        if (!ok) skippedBom++;
        return ok;
      })
      .map((r) => [String(r.id), String(r.process_id), String(r.material_id), num(r.units)]);
    await insertRows(client, "process_materials", ["id", "process_id", "material_id", "units"], bomRows);

    // ---- Productions — skip rows with missing process ----
    let skippedProd = 0;
    const prodRows = legProductions
      .filter((r) => {
        const ok = processIds.has(String(r.process_id));
        if (!ok) skippedProd++;
        return ok;
      })
      .map((r) => [String(r.id), String(r.process_id), num(r.units), clean(r.date)]);
    await insertRows(client, "productions", ["id", "process_id", "units", "date"], prodRows);

    // ---- Material orders (from legacy `orders`) — need valid supplier ----
    let skippedOrders = 0;
    const orderRows = legOrders
      .filter((o) => {
        const ok = supplierIds.has(String(o.supplier_id));
        if (!ok) skippedOrders++;
        return ok;
      })
      .map((o) => [
        String(o.id),
        String(o.supplier_id),
        clean(o.date_ordered),
        clean(o.date_delivered),
        num(o.cost),
        clean(o.notes),
      ]);
    const orderIds = new Set(orderRows.map((r) => r[0]));
    await insertRows(
      client,
      "material_orders",
      ["id", "supplier_id", "date_ordered", "date_delivered", "cost", "notes"],
      orderRows
    );

    // ---- Order materials (from legacy `order_material`) ----
    let skippedOrderMat = 0;
    const orderMatRows = legOrderMat
      .filter((r) => {
        const ok = orderIds.has(String(r.order_id)) && materialIds.has(String(r.material_id));
        if (!ok) skippedOrderMat++;
        return ok;
      })
      .map((r) => [String(r.id), String(r.order_id), String(r.material_id), num(r.units), !!r.delivered]);
    await insertRows(
      client,
      "order_materials",
      ["id", "order_id", "material_id", "units", "delivered"],
      orderMatRows
    );

    await client.query("COMMIT");

    // ---- Report ----
    console.log("Migration complete:");
    console.log(`  suppliers:        ${legSuppliers.length}`);
    console.log(`  materials:        ${legMaterials.length}`);
    console.log(`  processes:        ${legProcesses.length}  (flavor-linked: ${flavorLinked})`);
    console.log(`  process_materials:${bomRows.length}  (skipped orphans: ${skippedBom})`);
    console.log(`  productions:      ${prodRows.length}  (skipped orphans: ${skippedProd})`);
    console.log(`  material_orders:  ${orderRows.length}  (skipped orphans: ${skippedOrders})`);
    console.log(`  order_materials:  ${orderMatRows.length}  (skipped orphans: ${skippedOrderMat})`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
