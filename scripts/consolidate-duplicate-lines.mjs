// One-time consolidation of duplicate item lines (owner, 2026-09-12): rows on one
// parent with the same identity collapse into the earliest row with quantities
// summed. Identities match the merge-on-add rules in server/storage.ts.
//   npx tsx --env-file=.env scripts/consolidate-duplicate-lines.mjs dev|prod [--apply]
// Without --apply it only reports. Kept in the repo as the record of what ran.
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;
const env = process.argv[2];
const apply = process.argv.includes('--apply');
const url = env === 'prod' ? (process.env.PROD_DATABASE_URL || process.env.DATABASE_URL_PROD) : process.env.DATABASE_URL;
if (!url) { console.error('no db url for', env); process.exit(1); }
const pool = new Pool({ connectionString: url });

// Each entry: table, identity columns (with null-safe expressions), and any
// extra "keep the first non-null" columns to fold into the survivor.
const TABLES = [
  { table: 'retail_subscription_items', parent: 'subscription_id',
    identity: ['retail_product_id', "COALESCE(selected_flavor_id,'')", "COALESCE(notes,'')"], fold: ['unit_price_at_signup'] },
  { table: 'retail_order_items_v2', parent: 'order_id',
    identity: ['retail_product_id', "COALESCE(selected_flavor_id,'')", 'unit_price', "COALESCE(notes,'')"], fold: [] },
  { table: 'wholesale_order_items', parent: 'order_id',
    identity: ['unit_type_id', "COALESCE(flavor_id,'')"], fold: [] },
  { table: 'retail_cart_items', parent: 'session_id',
    identity: ['retail_product_id', "COALESCE(selected_flavor_id,'')", "COALESCE(split_flavor_id,'')", 'is_subscription', "COALESCE(subscription_frequency,'')"], fold: [] },
];

const client = await pool.connect();
try {
  if (apply) await client.query('BEGIN');
  for (const t of TABLES) {
    const key = [t.parent, ...t.identity].join(', ');
    const groups = (await client.query(`
      SELECT ${key}, array_agg(id ORDER BY id) AS ids, sum(quantity)::int AS qty
      FROM ${t.table} GROUP BY ${key} HAVING count(*) > 1`)).rows;
    console.log(`${env} ${t.table}: ${groups.length} duplicate group(s)`);
    for (const g of groups) {
      const [survivor, ...extras] = g.ids;
      console.log(`  keep ${survivor} (qty -> ${g.qty}), drop ${extras.length}`);
      if (!apply) continue;
      for (const col of t.fold) {
        await client.query(`
          UPDATE ${t.table} s SET ${col} = COALESCE(s.${col}, (SELECT ${col} FROM ${t.table} WHERE id = ANY($2) AND ${col} IS NOT NULL LIMIT 1))
          WHERE s.id = $1`, [survivor, extras]);
      }
      await client.query(`UPDATE ${t.table} SET quantity = $2 WHERE id = $1`, [survivor, g.qty]);
      await client.query(`DELETE FROM ${t.table} WHERE id = ANY($1)`, [extras]);
    }
  }
  if (apply) { await client.query('COMMIT'); console.log(`${env}: applied`); } else console.log(`${env}: dry run (pass --apply to consolidate)`);
} catch (e) {
  if (apply) await client.query('ROLLBACK').catch(() => {});
  throw e;
} finally {
  client.release();
  await pool.end();
}
