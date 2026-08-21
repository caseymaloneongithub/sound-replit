// Step 1: create the schema in the new production DB from the drizzle-generated DDL,
// then add anything the dev DB has that schema.ts doesn't declare (legacy columns some
// old code paths still write, plus manually-created indexes like the partial index on
// email_verification_codes.login_token).
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws"; neonConfig.webSocketConstructor = ws;
import { readFileSync } from "fs";

const dev = new Pool({ connectionString: process.env.DATABASE_URL });
const prod = new Pool({ connectionString: process.env.DATABASE_URL_PROD });

// sanity: never run against the same database twice
const devHost = new URL(process.env.DATABASE_URL.replace(/^postgresql/, 'http')).host;
const prodHost = new URL(process.env.DATABASE_URL_PROD.replace(/^postgresql/, 'http')).host;
if (devHost === prodHost) throw new Error("dev and prod URLs point at the same host — aborting");
if (!prodHost.includes("us-west-2")) throw new Error("prod host is not us-west-2 — aborting");
console.log(`dev:  ${devHost}\nprod: ${prodHost}\n`);

const existing = (await prod.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`)).rows[0].n;
if (existing > 0) { console.log(`prod already has ${existing} tables — skipping DDL (idempotent rerun)`); }
else {
  const ddl = readFileSync("migrations/0000_init.sql", "utf8");
  const statements = ddl.split("--> statement-breakpoint");
  console.log(`applying ${statements.length} DDL statements...`);
  for (const st of statements) { const s = st.trim(); if (s) await prod.query(s); }
  console.log("base schema created");
}

// Columns present in dev but missing in prod (legacy drift schema.ts doesn't declare)
const colQuery = `SELECT table_name, column_name, data_type, is_nullable, column_default,
                         character_maximum_length, numeric_precision, numeric_scale
                  FROM information_schema.columns WHERE table_schema='public'`;
const devCols = (await dev.query(colQuery)).rows;
const prodCols = new Set((await prod.query(colQuery)).rows.map(r => r.table_name + "." + r.column_name));
const prodTables = new Set((await prod.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map(r => r.table_name));

for (const c of devCols) {
  if (!prodTables.has(c.table_name)) continue; // dev-only tables (e.g. connect-pg-simple's) handled below
  if (prodCols.has(c.table_name + "." + c.column_name)) continue;
  let type = c.data_type;
  if (type === 'character varying') type = c.character_maximum_length ? `varchar(${c.character_maximum_length})` : 'varchar';
  if (type === 'numeric' && c.numeric_precision) type = `numeric(${c.numeric_precision},${c.numeric_scale ?? 0})`;
  if (type === 'ARRAY') type = 'text[]'; // all array cols in this schema are text[]
  if (type === 'USER-DEFINED') type = 'text';
  const nullable = c.is_nullable === 'YES' ? '' : ' NOT NULL';
  const def = c.column_default ? ` DEFAULT ${c.column_default}` : '';
  const sql = `ALTER TABLE "${c.table_name}" ADD COLUMN IF NOT EXISTS "${c.column_name}" ${type}${def}${nullable}`;
  await prod.query(sql);
  console.log(`  +col ${c.table_name}.${c.column_name} (${type})`);
}

// Dev tables that don't exist in prod at all (e.g. "session" from connect-pg-simple)
const devTables = (await dev.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`)).rows.map(r => r.table_name);
for (const t of devTables) {
  if (prodTables.has(t)) continue;
  console.log(`  table ${t} exists only in dev — creating from dev definition`);
  const cols = devCols.filter(c => c.table_name === t).map(c => {
    let type = c.data_type;
    if (type === 'character varying') type = c.character_maximum_length ? `varchar(${c.character_maximum_length})` : 'varchar';
    if (type === 'numeric' && c.numeric_precision) type = `numeric(${c.numeric_precision},${c.numeric_scale ?? 0})`;
    if (type === 'ARRAY') type = 'text[]';
    return `"${c.column_name}" ${type}${c.column_default ? ` DEFAULT ${c.column_default}` : ''}${c.is_nullable === 'YES' ? '' : ' NOT NULL'}`;
  }).join(", ");
  await prod.query(`CREATE TABLE IF NOT EXISTS "${t}" (${cols})`);
}

// Indexes in dev missing from prod (covers hand-made ones; replays exact indexdef)
const devIdx = (await dev.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'`)).rows;
const prodIdx = new Set((await prod.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`)).rows.map(r => r.indexname));
for (const i of devIdx) {
  if (prodIdx.has(i.indexname)) continue;
  try { await prod.query(i.indexdef.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS').replace('CREATE UNIQUE INDEX', 'CREATE UNIQUE INDEX IF NOT EXISTS')); console.log(`  +idx ${i.indexname}`); }
  catch (e) { console.log(`  !idx ${i.indexname}: ${e.message.split('\n')[0]}`); }
}

const finalTables = (await prod.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`)).rows[0].n;
console.log(`\nprod now has ${finalTables} tables (dev has ${devTables.length})`);
await dev.end(); await prod.end();
