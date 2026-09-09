-- Recipes (processes) get the same active flag materials have: inactive recipes are
-- retired but kept — hidden from the Recipes page unless "Show inactive" is on, and
-- excluded from the production-log picker and the "how many can we make" limit report.
-- Logged production history keeps counting everywhere. Existing rows stay active.
ALTER TABLE processes ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
