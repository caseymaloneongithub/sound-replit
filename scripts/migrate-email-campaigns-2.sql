-- Email campaigns, review round 2 (2026-09-11): durable per-row worker claims and
-- a database-enforced "one campaign sending at a time".
ALTER TABLE email_campaign_recipients ADD COLUMN IF NOT EXISTS claimed_at timestamp;

-- At most one row may carry status = 'sending' at any moment; a second insert
-- hits 23505 instead of racing past an application-level check.
CREATE UNIQUE INDEX IF NOT EXISTS email_campaigns_one_sending_idx
  ON email_campaigns (status) WHERE status = 'sending';
