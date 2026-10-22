-- Checkout snapshots: which checkout ATTEMPT (one page load of the cart checkout)
-- wrote them. The checkout page sends the same attempt id with every PaymentIntent it
-- creates and with its customer details, so a paid intent the snapshot doesn't name
-- can still be matched to its own checkout, never to a later one in the same browser
-- session (reviewer, 2026-10-22). Rerunnable.
ALTER TABLE retail_checkout_sessions ADD COLUMN IF NOT EXISTS attempt_id varchar;
CREATE INDEX IF NOT EXISTS retail_checkout_sessions_attempt_idx ON retail_checkout_sessions (attempt_id);
