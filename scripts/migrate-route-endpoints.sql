-- Editable route start/end points (2026-09-03): null means the brewery.
ALTER TABLE delivery_routes ADD COLUMN IF NOT EXISTS start_label text;
ALTER TABLE delivery_routes ADD COLUMN IF NOT EXISTS start_latitude decimal(10,7);
ALTER TABLE delivery_routes ADD COLUMN IF NOT EXISTS start_longitude decimal(10,7);
ALTER TABLE delivery_routes ADD COLUMN IF NOT EXISTS end_label text;
ALTER TABLE delivery_routes ADD COLUMN IF NOT EXISTS end_latitude decimal(10,7);
ALTER TABLE delivery_routes ADD COLUMN IF NOT EXISTS end_longitude decimal(10,7);
