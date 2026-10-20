-- Make fee-template supplier names unique PER ORGANIZATION instead of global.
--
-- `vendor_fee_templates.vendor_name` was declared TEXT NOT NULL UNIQUE in 0005,
-- before the table was org-scoped (0035 added org_id). That constraint is
-- global, so once one business has a template for "Sysco" no other business can
-- ever save one: the invoice screen saves the template silently after an
-- invoice is saved, so the fees are simply never remembered, and renaming a
-- supplier into a name another business uses fails half-way through the rename.
-- Same problem, same fix as categories in 0038.
--
-- SQLite cannot drop a constraint in place, so the table is rebuilt. Nothing
-- references vendor_fee_templates by foreign key, so the drop/rename is safe.
--
-- Uniqueness is restored as an expression index over COALESCE(org_id, '') and
-- LOWER(TRIM(vendor_name)) — the exact key the routes look a template up by —
-- so two rows can never answer the same lookup. COALESCE because SQLite treats
-- NULLs as distinct, and the NULL-org demo account holds templates too.

CREATE TABLE vendor_fee_templates_new (
  id             TEXT PRIMARY KEY,
  vendor_name    TEXT NOT NULL,
  delivery       REAL DEFAULT 0,
  fuel_surcharge REAL DEFAULT 0,
  tax_gst        REAL DEFAULT 0,
  tax_pst        REAL DEFAULT 0,
  other_cost     REAL DEFAULT 0,
  other_desc     TEXT DEFAULT '',
  use_percent    INTEGER DEFAULT 0,      -- 0=fixed $, 1=% of subtotal
  notes          TEXT DEFAULT '',
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  deposit        REAL DEFAULT 0,
  org_id         TEXT DEFAULT NULL REFERENCES organizations(id)
);

INSERT INTO vendor_fee_templates_new
  (id, vendor_name, delivery, fuel_surcharge, tax_gst, tax_pst, other_cost,
   other_desc, use_percent, notes, updated_at, deposit, org_id)
SELECT id, vendor_name, delivery, fuel_surcharge, tax_gst, tax_pst, other_cost,
       other_desc, use_percent, notes, updated_at, deposit, org_id
  FROM vendor_fee_templates;

DROP TABLE vendor_fee_templates;

ALTER TABLE vendor_fee_templates_new RENAME TO vendor_fee_templates;

-- Recreate the indexes dropped along with the old table.
CREATE INDEX idx_vendor_fee_templates_vendor ON vendor_fee_templates(vendor_name);
CREATE INDEX idx_vendor_fee_templates_org ON vendor_fee_templates(org_id);

-- Per-org name uniqueness, NULL-safe and case/space-insensitive (see note above).
CREATE UNIQUE INDEX idx_vendor_fee_templates_org_vendor
  ON vendor_fee_templates(COALESCE(org_id, ''), LOWER(TRIM(vendor_name)));
