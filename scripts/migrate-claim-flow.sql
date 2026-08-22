-- Claim-your-store flow. Idempotent; run against dev, then prod:
--   node --env-file=.env scripts/run-sql.mjs scripts/migrate-claim-flow.sql
--   node --env-file=.env -e "process.env.DATABASE_URL=process.env.DATABASE_URL_PROD" ... (see run-sql.mjs --prod)

ALTER TABLE wholesale_orders
  ADD COLUMN IF NOT EXISTS placed_by_user_id varchar REFERENCES users(id);

CREATE TABLE IF NOT EXISTS wholesale_link_requests (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id),
  email text NOT NULL,
  customer_id varchar NOT NULL REFERENCES wholesale_customers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  auto_approved boolean NOT NULL DEFAULT false,
  pending_order jsonb,
  placed_order_id varchar,
  deny_reason text,
  decided_at timestamp,
  decided_by_user_id varchar REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wholesale_link_requests_user_idx ON wholesale_link_requests(user_id);
CREATE INDEX IF NOT EXISTS wholesale_link_requests_status_idx ON wholesale_link_requests(status);

CREATE TABLE IF NOT EXISTS wholesale_store_searches (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar REFERENCES users(id),
  email text NOT NULL,
  query text NOT NULL,
  result_count integer NOT NULL DEFAULT 0,
  ip text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wholesale_store_searches_email_time_idx ON wholesale_store_searches(email, created_at);
