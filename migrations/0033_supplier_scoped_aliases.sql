-- ========================================================
-- Supplier-scoped product aliases
-- (see memory: substitutable-products-plan)
-- ========================================================
-- An alias records "this vendor's wording means that product of mine", so an
-- invoice line like "Grape Tomatoes" links to the existing "Small Tomatoes"
-- instead of creating a duplicate.
--
-- Until now an alias was name → product with no notion of WHO used that name
-- (0012 created it purely to remember names left behind by a merge). That's
-- too broad: two suppliers can use the same wording for genuinely different
-- items, and a global alias would silently mislink one of them.
--
-- supplier_id NULL keeps the old meaning — "any supplier" — so every existing
-- row behaves exactly as before. Matching prefers the more specific rule:
--   exact product name → alias for THIS supplier → global alias → create new.

ALTER TABLE product_aliases ADD COLUMN supplier_id TEXT DEFAULT NULL;

-- Lookups are always by alias name, optionally narrowed by supplier.
CREATE INDEX IF NOT EXISTS idx_product_aliases_alias_supplier
  ON product_aliases(alias_name, supplier_id);
