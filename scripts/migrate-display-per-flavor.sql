-- One shop card per flavor for a multi-flavor product (2026-09-03).
ALTER TABLE retail_products ADD COLUMN IF NOT EXISTS display_per_flavor boolean NOT NULL DEFAULT false;
