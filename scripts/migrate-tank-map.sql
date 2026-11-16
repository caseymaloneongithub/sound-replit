-- Tank map (2026-11-16): the brewhouse's vessels and what is in them. See
-- shared/schema.ts (vessels, vessel_fills) and shared/tank-map.ts. Rerunnable:
--   node --env-file=.env --env-file=.env.local scripts/run-sql.mjs scripts/migrate-tank-map.sql
--   node --env-file=.env scripts/run-sql.mjs scripts/migrate-tank-map.sql --prod
CREATE TABLE IF NOT EXISTS vessels (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL,
  capacity_bbl numeric(6,2),
  shape text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- How a vessel is drawn: 'conical' | 'pot' | 'tote' (owner, 2026-11-16: "Our brite tanks are
-- conical. Our small fermenters are pots. The large fermenter is an IBC tote.").
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS shape text;
CREATE TABLE IF NOT EXISTS vessel_fills (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id varchar NOT NULL REFERENCES vessels(id),
  flavor_id varchar NOT NULL REFERENCES flavors(id),
  filled_at timestamptz NOT NULL DEFAULT now(),
  brewed_at timestamptz,
  volume_bbl numeric(6,2),
  kegs integer,
  volume_bbl_in numeric(6,2),
  kegs_in integer,
  notes text,
  emptied_at timestamptz,
  outcome text,
  from_fill_id varchar REFERENCES vessel_fills(id),
  created_by_user_id varchar REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vessel_fills_open_idx ON vessel_fills(vessel_id) WHERE emptied_at IS NULL;
CREATE INDEX IF NOT EXISTS vessel_fills_activity_idx ON vessel_fills(greatest(filled_at, coalesce(emptied_at, filled_at)) DESC);
-- The amount as it went in, kept while volume_bbl / kegs shrink as parts move on or leave.
ALTER TABLE vessel_fills ADD COLUMN IF NOT EXISTS volume_bbl_in numeric(6,2);
ALTER TABLE vessel_fills ADD COLUMN IF NOT EXISTS kegs_in integer;
UPDATE vessel_fills SET volume_bbl_in = volume_bbl, kegs_in = kegs WHERE volume_bbl_in IS NULL AND kegs_in IS NULL;
-- The brewhouse as the owner described it (2026-11-16): four fermenters in a square, the
-- 10 bbl IBC tote top-left (FV1) and three 7 bbl pots; three 10 bbl conical brite tanks
-- in an L to their left; the keg fridge to the right. Names, sizes and shapes can be
-- changed on the page by an admin.
INSERT INTO vessels (id, name, kind, capacity_bbl, shape, display_order) VALUES
  ('fv1', 'FV1', 'fermenter', 10, 'tote', 1),
  ('fv2', 'FV2', 'fermenter', 7, 'pot', 2),
  ('fv3', 'FV3', 'fermenter', 7, 'pot', 3),
  ('fv4', 'FV4', 'fermenter', 7, 'pot', 4),
  ('bt1', 'BT1', 'brite', 10, 'conical', 1),
  ('bt2', 'BT2', 'brite', 10, 'conical', 2),
  ('bt3', 'BT3', 'brite', 10, 'conical', 3),
  ('fridge', 'Fridge', 'fridge', NULL, NULL, 1)
ON CONFLICT (id) DO NOTHING;
UPDATE vessels SET shape = CASE WHEN kind = 'brite' THEN 'conical' WHEN capacity_bbl >= 10 THEN 'tote' ELSE 'pot' END
  WHERE shape IS NULL AND kind <> 'fridge';
-- The first seed had the tote as FV4; it stands where FV1 is (owner, 2026-11-16: "The tote
-- is where you have FV1 now"). Swapped once, and only while neither has held anything.
UPDATE vessels SET capacity_bbl = 10, shape = 'tote' WHERE id = 'fv1' AND capacity_bbl = 7
  AND NOT EXISTS (SELECT 1 FROM vessel_fills WHERE vessel_id IN ('fv1', 'fv4'));
UPDATE vessels SET capacity_bbl = 7, shape = 'pot' WHERE id = 'fv4' AND capacity_bbl = 10
  AND (SELECT capacity_bbl FROM vessels WHERE id = 'fv1') = 10
  AND NOT EXISTS (SELECT 1 FROM vessel_fills WHERE vessel_id IN ('fv1', 'fv4'));
