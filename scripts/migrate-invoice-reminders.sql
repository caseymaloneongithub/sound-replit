-- Overdue invoice reminders (owner, 2026-10-07: "due today, 7 days overdue, 2
-- weeks, 3 weeks, ..."). The last reminder's stage and time on the invoice, and
-- a per-account switch.
--   node --env-file=.env scripts/run-sql.mjs scripts/migrate-invoice-reminders.sql [--prod]
-- Safe to run again; additive, harmless to the code running before it.
ALTER TABLE wholesale_orders ADD COLUMN IF NOT EXISTS payment_reminder_stage integer;
ALTER TABLE wholesale_orders ADD COLUMN IF NOT EXISTS payment_reminder_at timestamp;
ALTER TABLE wholesale_customers ADD COLUMN IF NOT EXISTS payment_reminders boolean NOT NULL DEFAULT true;
