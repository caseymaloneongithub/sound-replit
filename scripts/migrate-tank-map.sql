-- Tank map (2026-11-16): the brewhouse's vessels and what is in them. See
-- shared/schema.ts (vessels, vessel_fills) and shared/tank-map.ts. Rerunnable:
--   node --env-file=.env --env-file=.env.local scripts/run-sql.mjs scripts/migrate-tank-map.sql
--   node --env-file=.env scripts/run-sql.mjs scripts/migrate-tank-map.sql --prod
CREATE TABLE IF NOT EXISTS vessels (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL,
  capacity_gal numeric(6,2),
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
  volume_gal numeric(6,2),
  kegs integer,
  volume_gal_in numeric(6,2),
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
-- Gallons, not barrels (owner, 2026-11-16: "Let's go with gallons"). The first cut kept
-- barrels in capacity_bbl / volume_bbl / volume_bbl_in; a database that still has those
-- columns gets them renamed and converted once, at 31 gallons to the barrel.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'vessels' AND column_name = 'capacity_bbl') THEN
    ALTER TABLE vessels RENAME COLUMN capacity_bbl TO capacity_gal;
    UPDATE vessels SET capacity_gal = round(capacity_gal * 31, 2);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'vessel_fills' AND column_name = 'volume_bbl') THEN
    ALTER TABLE vessel_fills RENAME COLUMN volume_bbl TO volume_gal;
    UPDATE vessel_fills SET volume_gal = round(volume_gal * 31, 2);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'vessel_fills' AND column_name = 'volume_bbl_in') THEN
    ALTER TABLE vessel_fills RENAME COLUMN volume_bbl_in TO volume_gal_in;
    UPDATE vessel_fills SET volume_gal_in = round(volume_gal_in * 31, 2);
  END IF;
END $$;
-- The amount as it went in, kept while volume_gal / kegs shrink as parts move on or leave.
ALTER TABLE vessel_fills ADD COLUMN IF NOT EXISTS volume_gal_in numeric(6,2);
ALTER TABLE vessel_fills ADD COLUMN IF NOT EXISTS kegs_in integer;
UPDATE vessel_fills SET volume_gal_in = volume_gal, kegs_in = kegs WHERE volume_gal_in IS NULL AND kegs_in IS NULL;
-- The brewhouse as the owner described it (2026-11-16): four fermenters in a square, the
-- 10 bbl IBC tote top-left (FV1) and three 7 bbl pots; three 10 bbl conical brite tanks
-- in an L to their left; the keg fridge to the right. Sizes are what counts as full, in
-- gallons, as the owner gave them (2026-11-16): the tote 500 to the top, the pots 260, the
-- brites 310 (10 bbl, their max fill with headspace). Names, sizes and shapes can be
-- changed on the page by an admin.
INSERT INTO vessels (id, name, kind, capacity_gal, shape, display_order) VALUES
  ('fv1', 'FV1', 'fermenter', 500, 'tote', 1),
  ('fv2', 'FV2', 'fermenter', 260, 'pot', 2),
  ('fv3', 'FV3', 'fermenter', 260, 'pot', 3),
  ('fv4', 'FV4', 'fermenter', 260, 'pot', 4),
  ('bt1', 'BT1', 'brite', 310, 'conical', 1),
  ('bt2', 'BT2', 'brite', 310, 'conical', 2),
  ('bt3', 'BT3', 'brite', 310, 'conical', 3),
  ('fridge', 'Fridge', 'fridge', NULL, NULL, 1)
ON CONFLICT (id) DO NOTHING;
UPDATE vessels SET shape = CASE WHEN kind = 'brite' THEN 'conical' WHEN capacity_gal >= 300 THEN 'tote' ELSE 'pot' END
  WHERE shape IS NULL AND kind <> 'fridge';
-- Earlier seeds had the tote at 310 and then 330, and the pots at 217 (7 bbl at 31). Corrected
-- once each, while a vessel still carries an old figure.
UPDATE vessels SET capacity_gal = 500 WHERE id = 'fv1' AND shape = 'tote' AND capacity_gal IN (310, 330);
UPDATE vessels SET capacity_gal = 260 WHERE kind = 'fermenter' AND shape = 'pot' AND capacity_gal = 217;
