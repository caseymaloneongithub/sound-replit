-- Reorder emails for raw materials (owner, 2026-09-23: "watch at 50% and reorder at
-- 25%", and email the admins when an item goes to reorder status).
ALTER TABLE materials ADD COLUMN IF NOT EXISTS reorder_alerted_at timestamp;

-- Materials already at or below 25% of their reorder size when this ships count as
-- already announced, so the first stock change after the deploy doesn't email the
-- whole list. They re-arm, like any other, once stock climbs back above 25%.
UPDATE materials SET reorder_alerted_at = now()
WHERE reorder_alerted_at IS NULL
  AND is_active AND deleted_at IS NULL
  AND order_size > 0 AND stock <= order_size * 0.25;
