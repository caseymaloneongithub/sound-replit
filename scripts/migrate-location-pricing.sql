-- Per-location price overrides for multi-location wholesale customers (2026-09-09).
-- Resolution: location price -> customer price -> unit list price.
CREATE TABLE IF NOT EXISTS wholesale_location_pricing (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id varchar NOT NULL REFERENCES wholesale_locations(id) ON DELETE CASCADE,
  unit_type_id varchar NOT NULL REFERENCES wholesale_unit_types(id) ON DELETE CASCADE,
  custom_price decimal(10,2) NOT NULL,
  CONSTRAINT wholesale_location_pricing_location_unit_unique UNIQUE (location_id, unit_type_id)
)
