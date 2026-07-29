-- Make unit-name uniqueness PER ORGANIZATION instead of global.
--
-- The same defect 0038 fixed for `categories`, still present on `units`.
-- `units.name` was declared TEXT NOT NULL UNIQUE in 0010, long before the table
-- was org-scoped (0035 added org_id). Globally unique names mean that once one
-- organization has "kg", no other organization can ever have it — and account
-- creation seeds DEFAULT_UNITS in the same DB.batch() as the organization and
-- owner rows, so the constraint failure rolls the whole batch back and the
-- signup fails outright.
--
-- Production does not hit this: the constraint was dropped there by hand during
-- the 2026-07-29 seeding work, and no migration ever recorded it. So prod is
-- fine while any database rebuilt from these files — a fresh `npm run db:reset`,
-- or the staging environment that doesn't exist yet — gets the broken schema and
-- fails on its SECOND account. This migration closes that gap: it is a no-op in
-- effect against prod's current shape and a real fix everywhere else.
--
-- SQLite cannot drop a constraint in place, so the table is rebuilt. Units are
-- referenced by NAME everywhere (denormalized onto product_entries, inventory
-- and stock_take_items — see the unit-of-measure cascade), never by units.id,
-- and no foreign key points here, so the drop/rename is safe.
--
-- Uniqueness is restored as an expression index over COALESCE(org_id, ''), not a
-- plain UNIQUE(org_id, name): SQLite treats NULLs as distinct in a UNIQUE
-- constraint, which would let the NULL-org demo account collect duplicates.
-- Matching on LOWER(name) as well, because normalizeUnit() lower-cases
-- everything except "L" — "KG" and "kg" are the same unit and 0028 had to clean
-- up exactly that mess once already.

-- Drop any pre-existing duplicates first, or the unique index below cannot be
-- created. Same rule as 0028: keep the lowest id per (org, lower-cased name).
DELETE FROM units
WHERE id NOT IN (
  SELECT MIN(id) FROM units GROUP BY COALESCE(org_id, ''), LOWER(name)
);

CREATE TABLE units_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  org_id     TEXT    DEFAULT NULL REFERENCES organizations(id)
);

INSERT INTO units_new (id, name, sort_order, org_id)
SELECT id, name, sort_order, org_id FROM units;

DROP TABLE units;

ALTER TABLE units_new RENAME TO units;

-- Recreate the org lookup index dropped along with the old table.
CREATE INDEX idx_units_org ON units(org_id);

-- Per-org name uniqueness, NULL-safe and case-insensitive (see note above).
CREATE UNIQUE INDEX idx_units_org_name
  ON units(COALESCE(org_id, ''), LOWER(name));
