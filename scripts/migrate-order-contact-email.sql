-- Per-order contact email: who placed it may not be the billing contact.
ALTER TABLE wholesale_orders ADD COLUMN IF NOT EXISTS contact_email text;
