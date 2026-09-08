-- Wholesale unit availability date (2026-09-08): orderable now, deliverable from
-- this date. Null means available now.
ALTER TABLE wholesale_unit_types ADD COLUMN IF NOT EXISTS available_from timestamp;
