// Regression test: the finalize-vs-timeout race (reviewer P1, 2026-09-12).
//
// Interleaving under test:
//   1. timeout handler READS the subscription — no order yet, looks unpaid
//   2. the webhook's finalizer COMMITS: paid order + last_payment_intent_id,
//      status active (one transaction)
//   3. timeout handler writes its park decision
// The park must land ZERO rows (its NOT-EXISTS-paid-order condition is checked
// under the row lock at write time), leaving the subscription active. The
// control case (no finalization) must still park.
//
// Run: npx tsx --env-file=.env scripts/test-finalize-race.mjs
// Uses the dev database; creates and removes its own rows.
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const mkSub = async () => (await pool.query(`
  INSERT INTO retail_subscriptions
    (user_id, customer_name, customer_email, customer_phone, subscription_frequency,
     next_charge_at, next_delivery_date, status, billing_type, billing_status,
     stripe_customer_id, stripe_payment_method_id, processing_lock, retry_count)
  SELECT id, 'Race Test', 'race@test.local', '000', 'weekly',
     now() + interval '7 days', now() + interval '10 days', 'active', 'local_managed', 'active',
     'cus_race', 'pm_race', false, 0
  FROM users WHERE email = 'casey@soundkombucha.com' RETURNING id`)).rows[0].id;

const park = (id) => pool.query(`
  UPDATE retail_subscriptions SET status='pending', billing_status='first_charge_uncertain'
  WHERE id = $1 AND NOT EXISTS (
    SELECT 1 FROM retail_orders ro
    WHERE ro.stripe_payment_intent_id = retail_subscriptions.last_payment_intent_id
      AND ro.deleted_at IS NULL)
  RETURNING id`, [id]);

const state = async (id) => (await pool.query(
  `SELECT status, billing_status FROM retail_subscriptions WHERE id = $1`, [id])).rows[0];

const cleanup = async (id, pi) => {
  await pool.query(`DELETE FROM retail_orders WHERE stripe_payment_intent_id = $1`, [pi]);
  await pool.query(`DELETE FROM retail_subscriptions WHERE id = $1`, [id]);
};

let failures = 0;
const assert = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};

// --- Case 1: webhook commits BETWEEN the read and the park write ---
{
  const id = await mkSub();
  const pi = 'pi_race_' + Date.now();
  // Step 1: the timeout handler's read happened here (sub has no order — this
  // is implicit: nothing exists yet, so its decision was "park").
  // Step 2: the finalizer commits, atomically (order + stamp, one transaction).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO retail_orders (order_number, customer_name, customer_email, customer_phone,
        status, subtotal, tax_amount, total_amount, stripe_payment_intent_id, is_subscription_order)
      VALUES ($1, 'Race Test', 'race@test.local', '000', 'pending', '36.00', '3.73', '39.73', $2, true)`,
      ['RACE-' + Date.now(), pi]);
    await client.query(`
      UPDATE retail_subscriptions SET last_payment_intent_id = $2, status='active', billing_status='active'
      WHERE id = $1`, [id, pi]);
    await client.query('COMMIT');
  } finally { client.release(); }
  // Step 3: the stale park decision lands.
  const parked = await park(id);
  const s = await state(id);
  assert('finalized sub is NOT parked (0 rows)', parked.rowCount === 0, { parked: parked.rowCount });
  assert('finalized sub stays active/active', s.status === 'active' && s.billing_status === 'active', s);
  await cleanup(id, pi);
}

// --- Case 2 (control): no finalization — the park must land ---
{
  const id = await mkSub();
  const parked = await park(id);
  const s = await state(id);
  assert('unfinalized sub IS parked (1 row)', parked.rowCount === 1, { parked: parked.rowCount });
  assert('unfinalized sub is pending/uncertain', s.status === 'pending' && s.billing_status === 'first_charge_uncertain', s);
  await cleanup(id, 'none');
}

await pool.end();
if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('finalize-race regression: all assertions passed');
