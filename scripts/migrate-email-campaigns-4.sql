-- Scheduled campaign sends (owner, 2026-09-13). Timezone-aware so a Pacific
-- pick from the admin page compares correctly against now() on the server.
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
CREATE INDEX IF NOT EXISTS email_campaigns_scheduled_idx ON email_campaigns (scheduled_for) WHERE status = 'scheduled';
