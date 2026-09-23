-- Watch emails for raw materials too (owner, 2026-09-23: "let's have the email alert
-- when moved to watch as well"). Companion to migrate-material-reorder-alerts.sql.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS watch_alerted_at timestamp;

-- Materials already at or below 50% of their reorder size when this ships count as
-- already announced, so the first stock change after the deploy doesn't email them.
-- They re-arm, like any other, once stock climbs back above 50%.
UPDATE materials SET watch_alerted_at = now()
WHERE watch_alerted_at IS NULL
  AND is_active AND deleted_at IS NULL
  AND order_size > 0 AND stock <= order_size * 0.5;
