-- Operational events for super admins (2026-09-15): see shared/schema.ts opsEvents.
CREATE TABLE IF NOT EXISTS ops_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  severity text NOT NULL,
  kind text NOT NULL,
  message text NOT NULL,
  detail jsonb,
  ref_type text,
  ref_id text,
  acknowledged_at timestamptz,
  acknowledged_by_user_id varchar REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ops_events_created_at_idx ON ops_events(created_at DESC);
CREATE INDEX IF NOT EXISTS ops_events_open_alerts_idx ON ops_events(severity) WHERE acknowledged_at IS NULL;
