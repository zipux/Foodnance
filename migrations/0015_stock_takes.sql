-- ========================================================
-- Stock Take Feature
-- ========================================================

-- A stock take "session" — one per cycle (typically weekly)
CREATE TABLE IF NOT EXISTS stock_takes (
  id TEXT PRIMARY KEY,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  submitted_at DATETIME,
  status TEXT DEFAULT 'in_progress',
  total_items INTEGER DEFAULT 0,
  counted_items INTEGER DEFAULT 0,
  note TEXT DEFAULT ''
);

-- One row per inventory item per stock take.
-- counted_qty NULL = explicitly not counted this session.
CREATE TABLE IF NOT EXISTS stock_take_items (
  id TEXT PRIMARY KEY,
  stock_take_id TEXT NOT NULL,
  inventory_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT DEFAULT '',
  unit TEXT DEFAULT '',
  expected_qty REAL NOT NULL DEFAULT 0,
  counted_qty REAL,
  variance REAL,
  reason TEXT DEFAULT '',
  counted_at DATETIME,
  FOREIGN KEY (stock_take_id) REFERENCES stock_takes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stock_take_items_take ON stock_take_items(stock_take_id);
CREATE INDEX IF NOT EXISTS idx_stock_take_items_inv ON stock_take_items(inventory_id);
CREATE INDEX IF NOT EXISTS idx_stock_takes_status ON stock_takes(status);

-- Tie stock_log movements back to the stock take that produced them
ALTER TABLE stock_log ADD COLUMN stock_take_id TEXT DEFAULT '';
