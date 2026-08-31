-- Per-location invoice email (2026-08-31): multi-location stores (Evergreens) bill
-- each store's own inbox; the account email stays the fallback.
ALTER TABLE wholesale_locations ADD COLUMN IF NOT EXISTS contact_email text;
