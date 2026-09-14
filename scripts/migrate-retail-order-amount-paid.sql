-- Retail order edits (owner, 2026-09-14): what the customer has actually paid,
-- net of refunds, so an edited order can show a balance due or an overpayment.
-- Backfill: every order that carries a Stripe charge or invoice was paid in
-- full at its current total (minus a deposit already refunded).
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS amount_paid numeric(10,2);

UPDATE retail_orders
SET amount_paid = total_amount - CASE WHEN deposit_refunded_at IS NOT NULL THEN deposit_amount ELSE 0 END
WHERE amount_paid IS NULL
  AND status <> 'cancelled'
  AND (stripe_payment_intent_id IS NOT NULL OR stripe_invoice_id IS NOT NULL);
