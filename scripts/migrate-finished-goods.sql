-- Finished-goods integration: give products a structured identity (flavor × container),
-- teach wholesale unit types their container, and create the can/keg products so the
-- production→stock→fulfillment chain works for every package the brewery sells.
-- Idempotent. Run: node --env-file=.env scripts/run-sql.mjs scripts/migrate-finished-goods.sql [--prod]

ALTER TABLE products ADD COLUMN IF NOT EXISTS flavor_id varchar REFERENCES flavors(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS container text;
ALTER TABLE wholesale_unit_types ADD COLUMN IF NOT EXISTS container text;

-- Backfill the nine existing products: they are all bottle cases; match flavors by name
UPDATE products SET container = 'bottle-case' WHERE container IS NULL;
UPDATE products p SET flavor_id = f.id FROM flavors f
  WHERE p.flavor_id IS NULL AND lower(f.name) = lower(p.name);
UPDATE products p SET flavor_id = f.id FROM flavors f
  WHERE p.flavor_id IS NULL AND p.name = 'Mixed Case' AND f.name = 'Mixed';

-- Unit types declare their container
UPDATE wholesale_unit_types SET container = 'bottle-case' WHERE container IS NULL AND name ILIKE '%bottle%';
UPDATE wholesale_unit_types SET container = 'can-case'    WHERE container IS NULL AND name ILIKE '%can%';
UPDATE wholesale_unit_types SET container = 'keg-sixth'   WHERE container IS NULL AND (name ILIKE '%1/6%' OR name ILIKE '%sixth%');

-- One product per (flavor, container)
CREATE UNIQUE INDEX IF NOT EXISTS products_flavor_container_uq
  ON products(flavor_id, container) WHERE flavor_id IS NOT NULL AND container IS NOT NULL;

-- Product types for the new containers (products.product_type_id is NOT NULL)
INSERT INTO product_types (name, description, retail_price, wholesale_price, unit_type)
SELECT 'Case of 12 Cans', '12 cans per case', 30.00, 30.00, 'case'
WHERE NOT EXISTS (SELECT 1 FROM product_types WHERE name = 'Case of 12 Cans');
INSERT INTO product_types (name, description, retail_price, wholesale_price, unit_type)
SELECT '1/6 Barrel Keg', '5.16 gallons', 90.00, 90.00, '1/6-barrel'
WHERE NOT EXISTS (SELECT 1 FROM product_types WHERE name = '1/6 Barrel Keg');

-- Can-case products: every active flavor (incl. Mixed — variety cases exist in cans too)
INSERT INTO products (product_type_id, name, description, flavor, ingredients, retail_price, wholesale_price, image_url, in_stock, is_active, stock_quantity, low_stock_threshold, flavor_id, container)
SELECT pt.id, f.name || ' (Can Case)', f.name || ' — case of 12 cans', f.flavor_profile,
       f.ingredients, 30.00, 30.00, COALESCE(f.primary_image_url, ''), false, true, 0, 20, f.id, 'can-case'
FROM flavors f, product_types pt
WHERE pt.name = 'Case of 12 Cans' AND f.is_active
  AND NOT EXISTS (SELECT 1 FROM products p WHERE p.flavor_id = f.id AND p.container = 'can-case');

-- Keg products: real flavors only (nobody kegs the variety pack)
INSERT INTO products (product_type_id, name, description, flavor, ingredients, retail_price, wholesale_price, image_url, in_stock, is_active, stock_quantity, low_stock_threshold, flavor_id, container)
SELECT pt.id, f.name || ' (1/6 Keg)', f.name || ' — 1/6 barrel keg', f.flavor_profile,
       f.ingredients, 90.00, 90.00, COALESCE(f.primary_image_url, ''), false, true, 0, 2, f.id, 'keg-sixth'
FROM flavors f, product_types pt
WHERE pt.name = '1/6 Barrel Keg' AND f.is_active AND f.name <> 'Mixed'
  AND NOT EXISTS (SELECT 1 FROM products p WHERE p.flavor_id = f.id AND p.container = 'keg-sixth');
