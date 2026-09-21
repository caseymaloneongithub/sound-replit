-- Internal driver notes per wholesale location (owner, 2026-09-22): staff-written,
-- shown in Driver Mode, never returned to the customer portal.
ALTER TABLE wholesale_locations ADD COLUMN IF NOT EXISTS driver_notes text;
