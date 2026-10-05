-- Leads: street address, map pin and visit tag (owner, 2026-10-05: "add something
-- to the leads to tag it for a visit this week. Then it flows as an option to add
-- to the delivery route.")
--   node --env-file=.env scripts/run-sql.mjs scripts/migrate-lead-visits.sql [--prod]
-- Safe to run again: columns only if missing, backfill only where still empty.
-- Pins are not set here: Geocode All on the Routes page places leads that have
-- an address but no pin.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS state text DEFAULT 'WA';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS latitude numeric(10,7);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS longitude numeric(10,7);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS geocoded_at timestamp;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS visit_week date;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS visited_at timestamp;
ALTER TABLE delivery_route_stops ADD COLUMN IF NOT EXISTS lead_id varchar REFERENCES leads(id) ON DELETE CASCADE;

-- Imported leads carry the address in their notes after the "<area> route" part:
--   "… — cafe · Ballard route — 1417 NW 54th St #101, Seattle, 98107 — https://…"
-- Street is what sits before the last ", <city>, <zip>" of that part.
UPDATE leads SET
  address = trim(substring(notes from 'route[[:space:]]*—[[:space:]]*([^—]+),[[:space:]]*[^—,]+,[[:space:]]*[0-9]{5}')),
  city = trim(substring(notes from 'route[[:space:]]*—[[:space:]]*[^—]+,[[:space:]]*([^—,]+),[[:space:]]*[0-9]{5}'))
WHERE address IS NULL AND notes ~ 'route[[:space:]]*—[[:space:]]*[^—]+,[[:space:]]*[^—,]+,[[:space:]]*[0-9]{5}';

-- Website applications keep theirs on one line (see migrate-lead-type-zip.sql):
--   "Address: 12502 4th Avenue Northwest, Seattle, WA 98177"
UPDATE leads SET
  address = trim(substring(notes from '(?n)^Address: (.*), [^,]+, [A-Za-z]{2} [0-9]{5}')),
  city = trim(substring(notes from '(?n)^Address: .*, ([^,]+), [A-Za-z]{2} [0-9]{5}'))
WHERE address IS NULL AND notes ~ '(?n)^Address: .*, [^,]+, [A-Za-z]{2} [0-9]{5}';
