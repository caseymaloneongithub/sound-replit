-- Retail order edits, review round 3 (2026-09-14).
--
-- 1. Per-line deposit as charged, so recalculating an edited order doesn't
--    re-price deposits from today's catalogue. Backfilled from the catalogue
--    for existing lines (the best record there is); new lines capture it at
--    creation.
ALTER TABLE retail_order_items_v2 ADD COLUMN IF NOT EXISTS deposit_each numeric(10,2);
UPDATE retail_order_items_v2 i
SET deposit_each = COALESCE(rp.deposit, 0)
FROM retail_products rp
WHERE rp.id = i.retail_product_id AND i.deposit_each IS NULL;

-- 2. Refund operations, recorded before the Stripe call with their idempotency
--    key; a pending one is reconciled before any new refund on the same order.
CREATE TABLE IF NOT EXISTS retail_order_refunds (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id varchar NOT NULL REFERENCES retail_orders(id),
  kind text NOT NULL,
  amount numeric(10,2) NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  stripe_refund_id text,
  status text NOT NULL DEFAULT 'pending',
  created_by_user_id varchar REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
-- At most one refund in flight per order.
CREATE UNIQUE INDEX IF NOT EXISTS retail_order_refunds_one_pending_idx ON retail_order_refunds(order_id) WHERE status = 'pending';
