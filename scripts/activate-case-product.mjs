/**
 * Consolidated case product switchover (2026-09-03). RUN ONLY AFTER DEPLOYING the
 * flavor-aware stock deduction (commit with storage.ts LATERAL join) — on older
 * code, migrated items would deduct the anchor flavor's stock for every flavor.
 *
 *   npx tsx --env-file=.env scripts/activate-case-product.mjs
 *
 * In one transaction:
 *  1. Activates the "Case of 12 Bottles" multi-flavor product.
 *  2. Deactivates the per-flavor single-flavor bottle products (rows are KEPT —
 *     past orders and any unmigrated references keep working).
 *  3. Migrates subscription items and cart items from the per-flavor products to
 *     the consolidated one, backfilling selected_flavor_id from the old product's
 *     flavor. Locked subscription prices (unit_price_at_signup) are untouched.
 */
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.PROD_DATABASE_URL || process.env.DATABASE_URL_PROD });
const client = await pool.connect();
try {
  await client.query('BEGIN');

  const { rows: [target] } = await client.query(
    `SELECT id FROM retail_products WHERE product_name = 'Case of 12 Bottles' AND product_type = 'multi-flavor'`
  );
  if (!target) throw new Error('Consolidated product not found — run the creation step first');

  const { rows: oldProducts } = await client.query(`
    SELECT id, flavor_id FROM retail_products
    WHERE product_type = 'single-flavor' AND unit_description ILIKE '%bottle%' AND id <> $1
  `, [target.id]);
  const oldIds = oldProducts.map(p => p.id);
  console.log(`target ${target.id}; migrating away from ${oldIds.length} per-flavor products`);

  const subs = await client.query(`
    UPDATE retail_subscription_items si
    SET retail_product_id = $1,
        selected_flavor_id = COALESCE(si.selected_flavor_id, rp.flavor_id)
    FROM retail_products rp
    WHERE rp.id = si.retail_product_id AND si.retail_product_id = ANY($2::varchar[])
    RETURNING si.id
  `, [target.id, oldIds]);

  const carts = await client.query(`
    UPDATE retail_cart_items ci
    SET retail_product_id = $1,
        selected_flavor_id = COALESCE(ci.selected_flavor_id, rp.flavor_id)
    FROM retail_products rp
    WHERE rp.id = ci.retail_product_id AND ci.retail_product_id = ANY($2::varchar[])
    RETURNING ci.id
  `, [target.id, oldIds]);

  await client.query(`UPDATE retail_products SET is_active = false WHERE id = ANY($1::varchar[])`, [oldIds]);
  await client.query(`UPDATE retail_products SET is_active = true WHERE id = $1`, [target.id]);

  await client.query('COMMIT');
  console.log(`done: ${subs.rows.length} subscription items migrated, ${carts.rows.length} cart items migrated, ${oldIds.length} old products deactivated, consolidated product activated`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('ROLLED BACK:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
