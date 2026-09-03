-- Split case (2026-09-02): customer picks 2 flavors, half the case of each.
ALTER TABLE retail_products ADD COLUMN IF NOT EXISTS allow_split boolean NOT NULL DEFAULT false;
ALTER TABLE retail_cart_items ADD COLUMN IF NOT EXISTS split_flavor_id varchar REFERENCES flavors(id);
