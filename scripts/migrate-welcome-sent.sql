-- Track which retail users got the welcome/migration email, so bulk send is idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_sent_at timestamp;
