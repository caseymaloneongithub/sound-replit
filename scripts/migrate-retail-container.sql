-- Container becomes the canonical retail<->wholesale unit link (2026-09-05).
ALTER TABLE retail_products ADD COLUMN IF NOT EXISTS container text;

-- Backfill from the finished-goods link where one exists.
UPDATE retail_products rp SET container = p.container
FROM products p
WHERE rp.finished_product_id = p.id AND rp.container IS NULL;

-- Kegs have no finished link. They are the sixth-barrel container.
UPDATE retail_products SET container = 'keg-sixth'
WHERE container IS NULL
  AND (unit_description ILIKE '%keg%' OR unit_type ILIKE '%keg%' OR unit_type ILIKE '%barrel%');
