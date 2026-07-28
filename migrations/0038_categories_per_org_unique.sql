-- Make category-name uniqueness PER ORGANIZATION instead of global.
--
-- `categories.name` was declared TEXT NOT NULL UNIQUE back in 0018, before the
-- table was org-scoped (0035 added org_id). That constraint is global, so once
-- one organization has "Produce" no other organization can ever create it —
-- seeding the built-in taxonomy into a second customer fails on the first
-- duplicate name, and a customer typing a common category hits a constraint
-- error caused by data they cannot see.
--
-- SQLite cannot drop a constraint in place, so the table is rebuilt. Nothing
-- references categories by foreign key (products store their category as free
-- text), so the drop/rename is safe.
--
-- Uniqueness is restored as an expression index over COALESCE(org_id, '')
-- rather than a plain UNIQUE(org_id, name): SQLite treats NULLs as distinct in
-- a UNIQUE constraint, which would have let the NULL-org demo account collect
-- duplicate names — the one account most likely to be used for screenshots.

CREATE TABLE categories_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  type       TEXT    NOT NULL DEFAULT 'food',
  org_id     TEXT    DEFAULT NULL REFERENCES organizations(id)
);

INSERT INTO categories_new (id, name, sort_order, type, org_id)
SELECT id, name, sort_order, type, org_id FROM categories;

DROP TABLE categories;

ALTER TABLE categories_new RENAME TO categories;

-- Recreate the org lookup index dropped along with the old table.
CREATE INDEX idx_categories_org ON categories(org_id);

-- Per-org name uniqueness, NULL-safe (see note above).
CREATE UNIQUE INDEX idx_categories_org_name
  ON categories(COALESCE(org_id, ''), name);
