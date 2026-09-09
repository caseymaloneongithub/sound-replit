-- Materials get an active flag: inactive items are retired but kept — hidden from
-- the Materials list unless "Show inactive" is on, excluded from the reorder report,
-- dashboard stats, and the recipe/purchase-order pickers. Existing rows stay active.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
