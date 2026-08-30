-- Wholesale card payments (owner decision 2026-08-30): cards allowed by default,
-- switched off per account (e.g. large-invoice accounts where fees bite).
ALTER TABLE wholesale_customers ADD COLUMN IF NOT EXISTS allow_card_payment boolean NOT NULL DEFAULT true;
