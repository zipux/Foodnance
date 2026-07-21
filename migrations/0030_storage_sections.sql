-- ========================================================
-- User-defined storage sections (Fridge 1, Dry Store, …)
-- ========================================================
-- A stock take is walked place by place, not alphabetically. These two tables
-- let the user describe their physical layout so the counting screen can list
-- items in the order they are actually stored — section by section, and within
-- a section in whatever order they arranged (e.g. top-left to bottom-right).
--
-- DESIGN: one section per item. `item_placements` is UNIQUE on
-- (item_id, item_type), which encodes that decision in the schema. Multi-place
-- storage was considered and deliberately deferred: counting the same product
-- in two fridges only works if stock is tracked PER location, but `inventory`
-- holds a single total per item, so a partial count would show against the full
-- expected figure. That is a much larger feature.
--
-- Items with no placement are not lost — the UI groups them under "Unassigned"
-- and shows that group last, so nothing can silently drop out of a count.
--
-- Placement is keyed by (item_id, item_type) rather than by a foreign key to
-- one table because counted items come from three places: generic_products
-- (raw_material), recipes (batch) and finished_products (finished_product) —
-- the same pair `inventory` and `stock_take_items` already use.

CREATE TABLE IF NOT EXISTS storage_sections (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,       -- order the sections are walked in
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS item_placements (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL,
  item_type  TEXT NOT NULL,           -- raw_material | batch | finished_product
  section_id TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,       -- position within the section
  UNIQUE (item_id, item_type)         -- one section per item, by design
);

CREATE INDEX IF NOT EXISTS idx_item_placements_section ON item_placements(section_id);
CREATE INDEX IF NOT EXISTS idx_item_placements_item    ON item_placements(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_storage_sections_order  ON storage_sections(sort_order);
