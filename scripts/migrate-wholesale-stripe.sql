-- Saved ACH/card for wholesale invoice payments: each wholesale customer gets a
-- Stripe customer so Checkout can remember and re-offer their bank account.
ALTER TABLE wholesale_customers ADD COLUMN IF NOT EXISTS stripe_customer_id text;
