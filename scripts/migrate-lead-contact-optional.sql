-- Leads: the contact name is optional (owner, 2026-10-07: "Contact name is required
-- to add a lead. We don't usually have that at first."). Rerunnable.
ALTER TABLE leads ALTER COLUMN contact_name DROP NOT NULL;
