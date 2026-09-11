-- Email campaigns, review round 4 (2026-09-11): the idempotency-key window is
-- measured from the FIRST claim, which never moves, while claimed_at (the
-- lease) refreshes on every retry.
ALTER TABLE email_campaign_recipients ADD COLUMN IF NOT EXISTS first_claimed_at timestamp;
UPDATE email_campaign_recipients SET first_claimed_at = claimed_at WHERE first_claimed_at IS NULL AND claimed_at IS NOT NULL;
