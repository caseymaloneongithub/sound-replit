/**
 * Compare every table declared in shared/schema.ts against the live database and
 * report drift (columns declared but missing in the DB, and vice-versa).
 *
 * Read-only by default:
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/schema-diff.ts
 * Add missing columns (nullable adds only, never drops):
 *   ... scripts/schema-diff.ts --apply
 */
import { getTableConfig } from "drizzle-orm/pg-core";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import * as schema from "../shared/schema";

neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const APPLY = process.argv.includes("--apply");

async function main() {
  const dbCols = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`
  );
  const byTable = new Map<string, Set<string>>();
  for (const r of dbCols.rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, new Set());
    byTable.get(r.table_name)!.add(r.column_name);
  }

  let missingTotal = 0;
  const statements: string[] = [];

  for (const value of Object.values(schema)) {
    let cfg;
    try {
      cfg = getTableConfig(value as any);
    } catch {
      continue; // not a pgTable (types, zod schemas, etc.)
    }
    const actual = byTable.get(cfg.name);
    if (!actual) {
      console.log(`\n[TABLE MISSING] ${cfg.name} — declared in schema.ts but not in DB`);
      continue;
    }
    const declared = cfg.columns.map((c) => ({ name: c.name, type: c.getSQLType(), notNull: c.notNull }));
    const missing = declared.filter((c) => !actual.has(c.name));
    const extra = [...actual].filter((n) => !declared.some((c) => c.name === n));

    if (missing.length || extra.length) {
      console.log(`\n${cfg.name}`);
      for (const m of missing) {
        console.log(`  MISSING IN DB: ${m.name} ${m.type}${m.notNull ? " NOT NULL" : ""}`);
        missingTotal++;
        // Only ever add as nullable — adding NOT NULL to an existing table needs a default/backfill decision.
        statements.push(`ALTER TABLE "${cfg.name}" ADD COLUMN IF NOT EXISTS "${m.name}" ${m.type}`);
      }
      for (const e of extra) console.log(`  extra in DB (not in schema.ts): ${e}`);
    }
  }

  console.log(`\n--- ${missingTotal} column(s) declared in schema.ts but missing from the DB ---`);
  if (APPLY && statements.length) {
    for (const s of statements) {
      await pool.query(s);
      console.log("applied:", s);
    }
  } else if (statements.length) {
    console.log("(re-run with --apply to add them as nullable columns)");
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
