-- Optional customer PO number on wholesale orders (many accounts require one on invoices).
ALTER TABLE wholesale_orders ADD COLUMN IF NOT EXISTS po_number text;
