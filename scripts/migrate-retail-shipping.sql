-- Retail shipping (owner, 2026-10-05): cans-only cold-chain shipping, Mondays.
-- Rerunnable. Run on dev, then on prod with the deploy that carries shared/schema.ts.

-- Products: how a unit packs (null cans = not shippable, e.g. kegs).
ALTER TABLE retail_products ADD COLUMN IF NOT EXISTS cans_per_unit integer;
ALTER TABLE retail_products ADD COLUMN IF NOT EXISTS can_weight_oz numeric(6,2);

-- The insulated shippers. Edited on /admin/shipping.
CREATE TABLE IF NOT EXISTS shipping_boxes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  can_capacity integer NOT NULL,
  length_in numeric(6,2) NOT NULL,
  width_in numeric(6,2) NOT NULL,
  height_in numeric(6,2) NOT NULL,
  tare_weight_oz numeric(7,2) NOT NULL DEFAULT 0,
  ice_pack_count integer NOT NULL DEFAULT 0,
  ice_pack_weight_oz numeric(6,2) NOT NULL DEFAULT 0,
  packaging_fee_cents integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Starter rows: the two shippers the owner will use. Dimensions and weights are
-- placeholders to be replaced from the weighed samples on /admin/shipping.
INSERT INTO shipping_boxes (name, can_capacity, length_in, width_in, height_in, tare_weight_oz, ice_pack_count, ice_pack_weight_oz, packaging_fee_cents, display_order)
SELECT '12-can shipper', 12, 14, 10, 8, 32, 2, 16, 600, 1
WHERE NOT EXISTS (SELECT 1 FROM shipping_boxes WHERE can_capacity = 12);
INSERT INTO shipping_boxes (name, can_capacity, length_in, width_in, height_in, tare_weight_oz, ice_pack_count, ice_pack_weight_oz, packaging_fee_cents, display_order)
SELECT '24-can shipper', 24, 17, 12, 10, 48, 3, 16, 900, 2
WHERE NOT EXISTS (SELECT 1 FROM shipping_boxes WHERE can_capacity = 24);

-- Checkout snapshot: the quote the payment intent amount was raised to.
ALTER TABLE retail_checkout_sessions ADD COLUMN IF NOT EXISTS fulfillment_method text NOT NULL DEFAULT 'pickup';
ALTER TABLE retail_checkout_sessions ADD COLUMN IF NOT EXISTS ship_name text;
ALTER TABLE retail_checkout_sessions ADD COLUMN IF NOT EXISTS ship_address1 text;
ALTER TABLE retail_checkout_sessions ADD COLUMN IF NOT EXISTS ship_address2 text;
ALTER TABLE retail_checkout_sessions ADD COLUMN IF NOT EXISTS ship_city text;
ALTER TABLE retail_checkout_sessions ADD COLUMN IF NOT EXISTS ship_state text;
ALTER TABLE retail_checkout_sessions ADD COLUMN IF NOT EXISTS ship_zip text;
ALTER TABLE retail_checkout_sessions ADD COLUMN IF NOT EXISTS ship_phone text;
ALTER TABLE retail_checkout_sessions ADD COLUMN IF NOT EXISTS shipping_cents integer NOT NULL DEFAULT 0;
ALTER TABLE retail_checkout_sessions ADD COLUMN IF NOT EXISTS shipping_quote jsonb;
ALTER TABLE retail_checkout_sessions ADD COLUMN IF NOT EXISTS ship_date timestamp;
ALTER TABLE retail_checkout_sessions ADD COLUMN IF NOT EXISTS stripe_tax_calculation_id text;

-- Orders: address, charge, labels, tracking.
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS fulfillment_method text NOT NULL DEFAULT 'pickup';
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS ship_name text;
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS ship_address1 text;
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS ship_address2 text;
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS ship_city text;
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS ship_state text;
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS ship_zip text;
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS ship_phone text;
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS shipping_amount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS shipping_quote jsonb;
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS shipping_labels jsonb;
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS shipped_at timestamp;
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS delivered_at timestamp;
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS stripe_tax_calculation_id text;
ALTER TABLE retail_orders ADD COLUMN IF NOT EXISTS stripe_tax_transaction_id text;

CREATE INDEX IF NOT EXISTS idx_retail_orders_fulfillment ON retail_orders (fulfillment_method, status) WHERE deleted_at IS NULL;
