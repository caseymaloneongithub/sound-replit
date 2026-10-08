-- Leads: "brewery" joins the lead types (owner, 2026-10-07: "Add Brewery as a lead
-- type and convert obvious ones over"). The type is plain text with no constraint,
-- so only the obvious untyped breweries change: a name with Brewing / Brewery /
-- Brews as a word. Rerunnable.
UPDATE leads
SET business_type = 'brewery', updated_at = now()
WHERE business_type IS NULL
  AND business_name ~* '\m(brewing|brewery|brews)\M';
