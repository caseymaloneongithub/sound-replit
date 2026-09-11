// Regression test: the finalize-vs-timeout race (reviewer P1, 2026-09-12).
//
// The park mirrors production (routes.ts create-subscription charge-catch):
//   BEGIN; SELECT ... FOR UPDATE (subscription row);
//   separate statement: does a paid order exist for the stamped intent?
//   yes -> no park; no -> UPDATE to pending/first_charge_uncertain; COMMIT.
// The paid-order check MUST be its own statement after the lock: under READ
// COMMITTED a single conditional UPDATE that waits on the finalizer's lock
// re-checks only the locked row (EvalPlanQual) — a NOT-EXISTS subquery keeps
// the pre-wait snapshot and misses the order the finalizer committed.
//
// Case 1 is the reviewer-required OVERLAPPING interleaving, on two connections:
//   connA: BEGIN; insert paid order; stamp intent + active on the sub (holds lock)
//   connB: park starts and BLOCKS on the row lock
//   connA: COMMIT  ->  connB proceeds and must see the order: NO park.
// Case 2: finalization fully committed before the park starts: NO park.
// Case 3 (control): no finalization: the park must land.
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

// Production park sequence. Takes its own client so it can run concurrently
// with a finalizer held open on another connection.
const park = async (id) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const locked = await c.query(
      `SELECT last_payment_intent_id FROM retail_subscriptions WHERE id = $1 FOR UPDATE`, [id]);
    const pi = locked.rows[0]?.last_payment_intent_id;
    if (pi) {
      const paid = await c.query(
        `SELECT 1 FROM retail_orders WHERE stripe_payment_intent_id = $1 AND deleted_at IS NULL LIMIT 1`, [pi]);
      if (paid.rows.length > 0) { await c.query('COMMIT'); return { parked: false }; }
    }
    await c.query(
      `UPDATE retail_subscriptions SET status='pending', billing_status='first_charge_uncertain' WHERE id = $1`, [id]);
    await c.query('COMMIT');
    return { parked: true };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
};

// Finalizer-style transaction on a dedicated client: paid order + stamp + active,
// all one transaction (mirrors finalizeRetailSubscriptionCharge). Returns before
// COMMIT so Case 1 can hold it open; call fin.commit() to finish.
const openFinalizer = async (id, pi) => {
  const c = await pool.connect();
  await c.query('BEGIN');
  await c.query(`
    INSERT INTO retail_orders (order_number, customer_name, customer_email, customer_phone,
      status, subtotal, tax_amount, total_amount, stripe_payment_intent_id, is_subscription_order)
    VALUES ($1, 'Race Test', 'race@test.local', '000', 'pending', '36.00', '3.73', '39.73', $2, true)`,
    ['RACE-' + Date.now() + '-' + Math.floor(Math.random() * 1e6), pi]);
  await c.query(`
    UPDATE retail_subscriptions SET last_payment_intent_id = $2, status='active', billing_status='active'
    WHERE id = $1`, [id, pi]);
  return {
    commit: async () => { await c.query('COMMIT'); c.release(); },
  };
};

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Case 1: finalizer holds its transaction OPEN; the park starts, blocks on
// --- the row lock, and the finalizer commits only after the park is waiting ---
{
  const id = await mkSub();
  const pi = 'pi_race_overlap_' + Date.now();
  const fin = await openFinalizer(id, pi); // uncommitted: order invisible, row lock held
  const t0 = Date.now();
  const parkPromise = park(id);           // must block on FOR UPDATE
  await sleep(700);                        // let the park reach the lock wait
  await fin.commit();                      // release while the park is waiting
  const result = await parkPromise;
  const waited = Date.now() - t0;
  const s = await state(id);
  assert('overlapping park blocked on the finalizer lock (waited >= 600ms)', waited >= 600, { waited });
  assert('overlapping park does NOT park', result.parked === false, result);
  assert('overlapping: sub stays active/active', s.status === 'active' && s.billing_status === 'active', s);
  await cleanup(id, pi);
}

// --- Case 2: finalization fully committed BEFORE the park starts ---
{
  const id = await mkSub();
  const pi = 'pi_race_precommit_' + Date.now();
  const fin = await openFinalizer(id, pi);
  await fin.commit();
  const result = await park(id);
  const s = await state(id);
  assert('pre-committed finalization is NOT parked', result.parked === false, result);
  assert('pre-committed: sub stays active/active', s.status === 'active' && s.billing_status === 'active', s);
  await cleanup(id, pi);
}

// --- Case 3 (control): no finalization — the park must land ---
{
  const id = await mkSub();
  const result = await park(id);
  const s = await state(id);
  assert('unfinalized sub IS parked', result.parked === true, result);
  assert('unfinalized sub is pending/uncertain', s.status === 'pending' && s.billing_status === 'first_charge_uncertain', s);
  await cleanup(id, 'none');
}

await pool.end();
if (failures) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log('finalize-race regression: all assertions passed');
