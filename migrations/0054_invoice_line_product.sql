-- ============================================================
-- Invoice lines remember WHICH product they are, not just its name
-- ============================================================
-- Until now an invoice line knew its product only by name, and every report
-- that needed the product (the spending breakdown, the P&L cost split) matched
-- `invoice_lines.product_name` against product names. Any drift between the two
-- — a rename or merge whose name cascade missed the line, or a line filed under
-- an existing product through a supplier alias ("Fingerling" → "Yellow
-- Fingerling Potato") — silently dropped the line into "Uncategorized".
--
-- The id never changes, so a rename needs no cascade at all and a merge moves
-- the lines exactly (mergeInto re-points them like product_entries). Readers
-- prefer the id and fall back to the old name match only for a line without one.
--
-- Deliberately no REFERENCES clause: products are only ever archived
-- (deleted_at), never deleted, and a foreign key here would make the account
-- purge's delete order depend on it (tests/purge-coverage.test.mjs).
ALTER TABLE invoice_lines ADD COLUMN generic_product_id TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_lines_product ON invoice_lines(generic_product_id);

-- ── Backfill existing lines ─────────────────────────────────────
-- A wrong link is worse than none: it looks right, and nothing would ever flag
-- it. Every pass below links a line only when the answer is unambiguous, and
-- leaves it NULL otherwise — a NULL line still categorises by name, exactly as
-- before, so being conservative costs nothing that worked yesterday.

-- Pass 1 — the purchase record on the SAME invoice with the SAME amount. This
-- is what the invoice was actually filed under, whatever the line is called.
-- Taken only when every purchase record at that amount on that invoice points
-- at one product AND there are exactly as many of them as there are lines at
-- that amount (two $12.50 lines, one record = can't tell which line it is).
UPDATE invoice_lines
SET generic_product_id = (
  SELECT MIN(pe.generic_product_id)
  FROM product_entries pe
  JOIN generic_products gp ON gp.id = pe.generic_product_id AND gp.org_id IS invoice_lines.org_id
  WHERE pe.invoice_id = invoice_lines.invoice_id
    AND pe.org_id IS invoice_lines.org_id
    AND ABS(COALESCE(pe.cost, 0) - COALESCE(invoice_lines.line_total, 0)) < 0.005
)
WHERE generic_product_id IS NULL
  AND (
    SELECT COUNT(DISTINCT pe.generic_product_id)
    FROM product_entries pe
    JOIN generic_products gp ON gp.id = pe.generic_product_id AND gp.org_id IS invoice_lines.org_id
    WHERE pe.invoice_id = invoice_lines.invoice_id
      AND pe.org_id IS invoice_lines.org_id
      AND ABS(COALESCE(pe.cost, 0) - COALESCE(invoice_lines.line_total, 0)) < 0.005
  ) = 1
  AND (
    SELECT COUNT(*)
    FROM product_entries pe
    JOIN generic_products gp ON gp.id = pe.generic_product_id AND gp.org_id IS invoice_lines.org_id
    WHERE pe.invoice_id = invoice_lines.invoice_id
      AND pe.org_id IS invoice_lines.org_id
      AND ABS(COALESCE(pe.cost, 0) - COALESCE(invoice_lines.line_total, 0)) < 0.005
  ) = (
    SELECT COUNT(*)
    FROM invoice_lines il2
    WHERE il2.invoice_id = invoice_lines.invoice_id
      AND il2.org_id IS invoice_lines.org_id
      AND ABS(COALESCE(il2.line_total, 0) - COALESCE(invoice_lines.line_total, 0)) < 0.005
  );

-- Pass 2 — the line's name is exactly one product's name in its business.
-- (What the reports have always done, now pinned to an id so it survives the
-- next rename.) Two products sharing the name = ambiguous, left alone.
UPDATE invoice_lines
SET generic_product_id = (
  SELECT MIN(gp.id) FROM generic_products gp
  WHERE LOWER(TRIM(gp.name)) = LOWER(TRIM(invoice_lines.product_name))
    AND gp.org_id IS invoice_lines.org_id
)
WHERE generic_product_id IS NULL
  AND TRIM(COALESCE(product_name, '')) <> ''
  AND (
    SELECT COUNT(*) FROM generic_products gp
    WHERE LOWER(TRIM(gp.name)) = LOWER(TRIM(invoice_lines.product_name))
      AND gp.org_id IS invoice_lines.org_id
  ) = 1;

-- Pass 3 — the line's name is the name purchases were filed under, and all of
-- those purchases point at one product.
UPDATE invoice_lines
SET generic_product_id = (
  SELECT MIN(pe.generic_product_id)
  FROM product_entries pe
  JOIN generic_products gp ON gp.id = pe.generic_product_id AND gp.org_id IS invoice_lines.org_id
  WHERE LOWER(TRIM(pe.generic_product_name)) = LOWER(TRIM(invoice_lines.product_name))
    AND pe.org_id IS invoice_lines.org_id
)
WHERE generic_product_id IS NULL
  AND TRIM(COALESCE(product_name, '')) <> ''
  AND (
    SELECT COUNT(DISTINCT pe.generic_product_id)
    FROM product_entries pe
    JOIN generic_products gp ON gp.id = pe.generic_product_id AND gp.org_id IS invoice_lines.org_id
    WHERE LOWER(TRIM(pe.generic_product_name)) = LOWER(TRIM(invoice_lines.product_name))
      AND pe.org_id IS invoice_lines.org_id
  ) = 1;
