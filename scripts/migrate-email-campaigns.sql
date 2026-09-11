-- Email campaigns (reviewer round, 2026-09-11): persistent marketing opt-outs,
-- and campaigns + per-recipient delivery state so a restart resumes instead of
-- abandoning or duplicating sends.
CREATE TABLE IF NOT EXISTS marketing_opt_outs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  reason text,
  created_by varchar,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  audience text NOT NULL,
  body_html text NOT NULL,
  status text NOT NULL DEFAULT 'sending',
  created_by varchar,
  created_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);

CREATE TABLE IF NOT EXISTS email_campaign_recipients (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id varchar NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'pending',
  error text,
  sent_at timestamp
);

CREATE INDEX IF NOT EXISTS email_campaign_recipients_campaign_status_idx
  ON email_campaign_recipients (campaign_id, status);
