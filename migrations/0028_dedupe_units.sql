-- 0028_dedupe_units.sql
-- Remove duplicate rows from the units table (it was seeded twice by an earlier
-- migration re-run, e.g. two 'kg', two 'lb'). Units are referenced by NAME
-- everywhere (denormalized), never by units.id, so deleting the extra rows is
-- safe and purely a data-hygiene cleanup. Keep the lowest id per unit name
-- (case-insensitive), delete the rest.

DELETE FROM units
WHERE id NOT IN (
  SELECT MIN(id) FROM units GROUP BY LOWER(name)
);
