-- Wholesale order emails (2026-09-14): an order's stored contact_email only
-- overrides the location/account routing when it was a deliberate choice.
-- Historical rows (auto-filled portal login emails, guest-typed addresses from
-- before the rule) stay inert: false for all.
ALTER TABLE wholesale_orders ADD COLUMN IF NOT EXISTS contact_email_chosen boolean NOT NULL DEFAULT false;
