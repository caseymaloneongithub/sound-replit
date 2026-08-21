// Step 2: copy ALL rows dev -> prod ("bring everything" per user), tables topologically
// sorted by FK dependencies so parents land before children. Second pass retries any
// table that failed (covers odd orderings). Chunked multi-row inserts.
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws"; neonConfig.webSocketConstructor = ws;
const dev = new Pool({ connectionString: process.env.DATABASE_URL });
const prod = new Pool({ connectionString: process.env.DATABASE_URL_PROD });
if (!process.env.DATABASE_URL_PROD.includes("us-west-2")) throw new Error("prod not us-west-2");

const tables = (await dev.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`)).rows.map(r => r.table_name);

// FK edges: child depends on parent
const fks = (await dev.query(`
  SELECT tc.table_name AS child, ccu.table_name AS parent
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema='public'
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`)).rows;

const deps = new Map(tables.map(t => [t, new Set()]));
for (const f of fks) if (f.child !== f.parent && deps.has(f.child)) deps.get(f.child).add(f.parent);
const ordered = [];
const placed = new Set();
let guard = 0;
while (ordered.length < tables.length && guard++ < 200) {
  for (const t of tables) {
    if (placed.has(t)) continue;
    if ([...deps.get(t)].every(p => placed.has(p) || !deps.has(p))) { ordered.push(t); placed.add(t); }
  }
}
for (const t of tables) if (!placed.has(t)) { ordered.push(t); console.log(`(cycle) ${t} appended last`); }

async function copyTable(t) {
  const { rows } = await dev.query(`SELECT * FROM "${t}"`);
  if (rows.length === 0) return { t, n: 0 };
  const cols = Object.keys(rows[0]);
  const colList = cols.map(c => `"${c}"`).join(",");
  const chunk = Math.max(1, Math.floor(30000 / cols.length));
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params = []; const tuples = [];
    slice.forEach((r, ri) => {
      tuples.push("(" + cols.map((c, ci) => `$${ri * cols.length + ci + 1}`).join(",") + ")");
      cols.forEach(c => params.push(r[c]));
    });
    await prod.query(`INSERT INTO "${t}" (${colList}) VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`, params);
  }
  return { t, n: rows.length };
}

const failed = [];
for (const t of ordered) {
  try { const r = await copyTable(t); if (r.n) console.log(`  ${t}: ${r.n}`); }
  catch (e) { failed.push(t); console.log(`  ! ${t}: ${e.message.split("\n")[0]}`); }
}
for (const t of failed) {
  try { const r = await copyTable(t); console.log(`  retry ${t}: ${r.n} OK`); }
  catch (e) { console.log(`  RETRY FAILED ${t}: ${e.message.split("\n")[0]}`); }
}

// verify counts
console.log("\n=== count verification (dev vs prod) ===");
let mismatches = 0;
for (const t of tables) {
  const a = (await dev.query(`SELECT count(*)::int n FROM "${t}"`)).rows[0].n;
  const b = (await prod.query(`SELECT count(*)::int n FROM "${t}"`)).rows[0].n;
  if (a !== b) { mismatches++; console.log(`  MISMATCH ${t}: dev=${a} prod=${b}`); }
}
console.log(mismatches === 0 ? "all table counts match ✓" : `${mismatches} mismatches`);
await dev.end(); await prod.end();
