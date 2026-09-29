-- Leads: business type and zip code (owner, 2026-09-29: "Sort by fields should be
-- name and zip code. Also add a filter for type (gym, coffee, restaurant, grocery).")
--   node --env-file=.env scripts/run-sql.mjs scripts/migrate-lead-type-zip.sql [--prod]
-- Safe to run again: columns only if missing, backfill only where still empty.
-- The patterns use POSIX classes, not \s or \d, so they read the same however the
-- server treats backslashes in string literals.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_type text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS zip_code varchar(10);

-- Both come from the notes the imported leads carry:
--   "... — cafe · Ballard route — 1417 NW 54th St #101, Seattle, 98107 — https://..."
-- Zip: the 5 digits after the city, before the website (or at the end).
UPDATE leads SET zip_code = substring(notes from ',[[:space:]]*([0-9]{5})[[:space:]]*(—|$)')
WHERE zip_code IS NULL AND notes ~ ',[[:space:]]*[0-9]{5}[[:space:]]*(—|$)';

-- Type: the category before " · <area> route". cafe is coffee; restaurant, grocery
-- and gym are themselves; anything else (brewery) stays empty for staff to set.
UPDATE leads SET business_type = CASE lower(substring(notes from '—[[:space:]]*([A-Za-z]+)[[:space:]]*·[^—]*route'))
    WHEN 'cafe' THEN 'coffee'
    WHEN 'restaurant' THEN 'restaurant'
    WHEN 'grocery' THEN 'grocery'
    WHEN 'gym' THEN 'gym'
  END
WHERE business_type IS NULL AND notes ~ '—[[:space:]]*[A-Za-z]+[[:space:]]*·[^—]*route';
