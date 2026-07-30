-- POS sales import + inventory backflush.
--
-- The app already knows what a business BUYS (invoices). It has never known what
-- it SELLS, so stock only ever rises on its own and variance reporting — the
-- thing Pro is sold on — cannot exist. These tables are the missing input.
--
-- THE SHAPE MIRRORS INVOICES, deliberately. A CSV is parsed in the browser
-- (public/static/pos-parse.js), stashed whole as JSON in pos_imports.parsed_data
-- with status 'Action Required', reviewed on a separate screen where each POS
-- menu item is mapped to a recipe or finished product, and only then committed —
-- at which point parsed_data is cleared and pos_sale_lines is written. Same
-- reasoning as migration 0011: the review has to survive a refresh, a dropped
-- connection, or being finished on a different device.
--
-- CONSEQUENCE: pos_sale_lines holds ONLY committed lines. That is what lets the
-- idempotency index below be a hard constraint rather than a check someone can
-- forget to run.

CREATE TABLE pos_imports (
  id             TEXT PRIMARY KEY,
  org_id         TEXT DEFAULT NULL REFERENCES organizations(id),
  -- 'square' today. The parser is a registry, so 'clover' is a new entry there
  -- and a new value here, with no schema change.
  source         TEXT NOT NULL DEFAULT 'square',
  file_name      TEXT NOT NULL DEFAULT '',
  -- R2 key of the raw CSV. The audit artefact, same role as the invoice photo:
  -- when a number is disputed a year later, the original export is the answer.
  file_key       TEXT NOT NULL DEFAULT '',
  -- 'Action Required' (parsed, nothing derived written) | 'Closed' (committed).
  -- Same vocabulary as invoices.status, minus 'In Processing' — that has no
  -- analogue here because parsing is local and instant.
  status         TEXT NOT NULL DEFAULT 'Action Required',
  period_start   TEXT NOT NULL DEFAULT '',      -- earliest sold_date, 'YYYY-MM-DD'
  period_end     TEXT NOT NULL DEFAULT '',      -- latest sold_date
  line_count     INTEGER NOT NULL DEFAULT 0,
  gross_total    REAL NOT NULL DEFAULT 0,
  discount_total REAL NOT NULL DEFAULT 0,
  net_total      REAL NOT NULL DEFAULT 0,       -- gross - discounts, EXCLUDES tax
  tax_total      REAL NOT NULL DEFAULT 0,
  -- Denormalised coverage, so the list screen can show "24% of sales untracked"
  -- without opening every import's lines.
  mapped_net     REAL NOT NULL DEFAULT 0,
  unmapped_net   REAL NOT NULL DEFAULT 0,
  warning_count  INTEGER NOT NULL DEFAULT 0,
  -- Full parser output while in review. Cleared to '' on commit, exactly like
  -- invoices.parsed_data (migration 0011).
  parsed_data    TEXT NOT NULL DEFAULT '',
  -- SHA-256 of the raw CSV text. First line of defence against a double import:
  -- re-uploading the identical file is never intentional. Warned on, with an
  -- explicit override, mirroring the duplicate-invoice-number check in
  -- public/static/invoice.js.
  content_hash   TEXT NOT NULL DEFAULT '',
  committed_at   TEXT DEFAULT NULL,
  voided_at      TEXT DEFAULT NULL,
  void_reason    TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_pos_imports_org_status ON pos_imports(org_id, status);
-- Duplicate-file lookup. Deliberately an index and not a unique constraint: a
-- voided import must be re-importable, so uniqueness here would be wrong.
CREATE INDEX idx_pos_imports_org_hash ON pos_imports(org_id, content_hash);


CREATE TABLE pos_sale_lines (
  id            TEXT PRIMARY KEY,
  org_id        TEXT DEFAULT NULL REFERENCES organizations(id),
  import_id     TEXT NOT NULL REFERENCES pos_imports(id),
  sold_date     TEXT NOT NULL DEFAULT '',      -- 'YYYY-MM-DD', as the POS reported it
  sold_time     TEXT NOT NULL DEFAULT '',
  pos_item_name TEXT NOT NULL DEFAULT '',
  pos_item_key  TEXT NOT NULL DEFAULT '',      -- normalised; joins to pos_item_map
  pos_category  TEXT NOT NULL DEFAULT '',      -- drives the food/beverage split in P&L
  pos_sku       TEXT NOT NULL DEFAULT '',
  price_point   TEXT NOT NULL DEFAULT '',      -- 'Regular' / 'Large' — size variants
  -- Kept verbatim, unused in v1. Modifiers carry real cost ("Extra Mozzarella")
  -- and this is the only chance to capture them; mining them later must not
  -- require the customer to re-export a year of sales.
  modifiers     TEXT NOT NULL DEFAULT '',
  qty           REAL NOT NULL DEFAULT 0,
  gross_sales   REAL NOT NULL DEFAULT 0,
  discounts     REAL NOT NULL DEFAULT 0,
  net_sales     REAL NOT NULL DEFAULT 0,
  tax           REAL NOT NULL DEFAULT 0,

  -- WHAT WAS ACTUALLY APPLIED, snapshotted from pos_item_map at commit time.
  -- Not a join: the mapping is a learned rule that will be edited later, and a
  -- deduction that has already happened must stay explicable when it is. Same
  -- reasoning as stock_take_items.expected_qty being frozen rather than
  -- recomputed. An empty target_type means imported but not backflushed.
  target_type   TEXT NOT NULL DEFAULT '',      -- '' | 'recipe' | 'finished_product' | 'ignore'
  target_id     TEXT NOT NULL DEFAULT '',
  target_name   TEXT NOT NULL DEFAULT '',
  qty_per_sale  REAL NOT NULL DEFAULT 1,
  target_unit   TEXT NOT NULL DEFAULT '',
  -- Set when explosion produced at least one movement. Together with
  -- deplete_error this distinguishes three situations that need three different
  -- fixes: not mapped / mapped but the recipe is empty / mapped but a unit
  -- could not be converted.
  depleted      INTEGER NOT NULL DEFAULT 0,
  deplete_error TEXT NOT NULL DEFAULT '',

  -- IDEMPOTENCY. Square's 'Record ID' identifies one itemisation uniquely. When
  -- a format has no such id (Clover, or a summary-style export), the commit
  -- route synthesises one from the row's own content, so a single column and a
  -- single index cover both cases.
  external_ref  TEXT NOT NULL DEFAULT '',
  external_txn  TEXT NOT NULL DEFAULT '',      -- Square 'Transaction ID', for tracing

  -- Denormalised from the parent so a void is one UPDATE, exactly as voiding an
  -- invoice flags its product_entries, and so the partial index below can
  -- exclude voided rows.
  voided_at     TEXT DEFAULT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_pos_sale_lines_import   ON pos_sale_lines(import_id);
CREATE INDEX idx_pos_sale_lines_org_date ON pos_sale_lines(org_id, sold_date);

-- THE double-import guard. Exporting Jul 1-15 and then Jul 1-31 is the normal
-- way this goes wrong, and a hash of the file cannot catch it. This makes the
-- overlap structurally impossible rather than merely checked for. Voided lines
-- are excluded so that void-and-reimport works.
CREATE UNIQUE INDEX idx_pos_sale_lines_ext
  ON pos_sale_lines(COALESCE(org_id, ''), external_ref)
  WHERE external_ref != '' AND voided_at IS NULL;


-- The LEARNED mapping: "when Square says 'Margherita Pizza', that is my
-- Margherita finished product." Directly analogous to product_aliases
-- (0012/0033) — the rule survives across imports so the second upload routes
-- itself and the reviewer only sees what is genuinely new.
CREATE TABLE pos_item_map (
  id            TEXT PRIMARY KEY,
  org_id        TEXT DEFAULT NULL REFERENCES organizations(id),
  source        TEXT NOT NULL DEFAULT 'square',
  -- Normalised 'item|price point'. A key ending in '|' (empty price point) is
  -- the "any size" rule and is the FALLBACK when no size-specific rule exists —
  -- the same most-specific-first precedence as supplier-scoped vs global
  -- aliases. A Large pizza really does use more dough, so size has to be part
  -- of the key from day one; making it a fallback keeps the common case to one
  -- click.
  pos_item_key  TEXT NOT NULL,
  pos_item_name TEXT NOT NULL DEFAULT '',      -- as it appeared, for display
  price_point   TEXT NOT NULL DEFAULT '',
  -- 'recipe' | 'finished_product' | 'ignore'.
  -- 'ignore' is load-bearing: without it, gift cards, bottled drinks and service
  -- charges keep the "needs mapping" warning permanently lit, and a warning that
  -- is always on is a warning nobody reads.
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL DEFAULT '',
  -- How much of the target one POS unit consumes. 1 for a finished product. For
  -- a recipe, 1 + recipe.yield_unit means "one sale eats one yield unit",
  -- scaled by servings exactly as Produce Batch does.
  qty_per_sale  REAL NOT NULL DEFAULT 1,
  target_unit   TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_pos_item_map_key
  ON pos_item_map(COALESCE(org_id, ''), source, pos_item_key);


-- Which import a stock movement came from, so voiding an import can find and
-- reverse exactly its own movements. Shape copied from stock_log.stock_take_id
-- (0015) rather than inventing a movements table — the log already IS the
-- movement record.
ALTER TABLE stock_log ADD COLUMN pos_import_id TEXT DEFAULT '';
CREATE INDEX idx_stock_log_pos_import ON stock_log(pos_import_id);


-- PER-RECIPE DEPLETION PATH — the double-counting guard.
--
-- A recipe can be consumed two ways, and they must never both fire:
--
--   'on_demand' (default) — the sauce is made when the dish is ordered, so
--       selling the dish explodes the recipe into its raw_material bins.
--   'batched'             — the sauce is made ahead into a `batch` bin, so
--       selling the dish deducts THAT bin and Produce Batch refills it from raw
--       materials. Deducting raw materials here as well would count every
--       tomato twice, inventory would drift within a week, and the customer
--       would stop trusting the whole app.
--
-- TEXT rather than a boolean because a third mode is already foreseeable
-- ('ignore', for a recipe that must never be backflushed) and because it reads
-- plainly in a SELECT *. Matches invoices.status / stock_takes.status.
ALTER TABLE recipes ADD COLUMN production_mode TEXT NOT NULL DEFAULT 'on_demand';

-- BACKFILL: a recipe that already holds batch stock is, by observation, made in
-- batches. Leaving those on the default would double-count from the very first
-- import — the single most damaging way this feature could go wrong, and the one
-- least likely to be noticed quickly.
UPDATE recipes SET production_mode = 'batched'
WHERE EXISTS (
  SELECT 1 FROM inventory i
   WHERE i.item_id = recipes.id
     AND i.item_type = 'batch'
     AND i.org_id IS recipes.org_id
     AND COALESCE(i.quantity, 0) != 0
);
