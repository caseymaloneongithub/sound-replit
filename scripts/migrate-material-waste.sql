-- Materials: a waste rate (owner, 2026-10-15: "if I say 2% of cans are wasted, then
-- the inventories and costs reflect that 2% additional usage"). A percentage on top
-- of what recipes call for, applied wherever a recipe line becomes a quantity
-- (shared/material-waste.ts). Rerunnable.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS waste_rate numeric(6,3) NOT NULL DEFAULT 0;
