-- Per-item packing notes (mixed-case composition), 2026-08-30.
-- Subscription items hold the standing note; order items get a copy on each
-- generated order so the orders board can show what goes in the case.
ALTER TABLE retail_subscription_items ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE retail_order_items_v2 ADD COLUMN IF NOT EXISTS notes text;
