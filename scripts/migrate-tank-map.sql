-- Tank map (2026-11-16): the brewhouse's vessels and what is in them. See
-- shared/schema.ts (vessels, vessel_fills) and shared/tank-map.ts. Rerunnable:
--   node --env-file=.env --env-file=.env.local scripts/run-sql.mjs scripts/migrate-tank-map.sql
--   node --env-file=.env scripts/run-sql.mjs scripts/migrate-tank-map.sql --prod
CREATE TABLE IF NOT EXISTS vessels (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL,
  capacity_bbl numeric(6,2),
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
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
-- The brewhouse as the owner described it (2026-11-16): four fermenters in a square,
-- three 7 bbl and one 10 bbl; three 10 bbl brite tanks in an L to their left; the keg
-- fridge to the right. Names and sizes can be changed on the page by an admin.
INSERT INTO vessels (id, name, kind, capacity_bbl, display_order) VALUES
  ('fv1', 'FV1', 'fermenter', 7, 1),
  ('fv2', 'FV2', 'fermenter', 7, 2),
  ('fv3', 'FV3', 'fermenter', 7, 3),
  ('fv4', 'FV4', 'fermenter', 10, 4),
  ('bt1', 'BT1', 'brite', 10, 1),
  ('bt2', 'BT2', 'brite', 10, 2),
  ('bt3', 'BT3', 'brite', 10, 3),
  ('fridge', 'Fridge', 'fridge', NULL, 1)
ON CONFLICT (id) DO NOTHING;
