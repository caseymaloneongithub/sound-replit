-- Leads: a website of their own (owner, 2026-10-07: "we can't add the website in
-- the edit modal"). The sheet keeps showing a link found in the notes when this is
-- blank. Rerunnable.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS website text;
