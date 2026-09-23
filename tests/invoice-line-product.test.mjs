// Static audit: invoice lines are tied to their product by ID (migration 0054),
// and nothing on the way in or out quietly drops that tie.
//
// The spending breakdown and the P&L used to find a line's category by matching
// its NAME against product names. Any drift — a supplier alias ("Fingerling"
// filed under "Yellow Fingerling Potato"), a rename or merge whose name cascade
// missed the line — dropped real spend into "Uncategorized". The id fixes that
// only if every writer keeps it:
//   · the replace route deletes and re-inserts every line, so an editor that
//     doesn't send the id back unlinks the whole invoice on each save;
//   · Confirm & Save must hand the new line ids to the product import, which is
//     where the product is actually decided;
//   · merge must re-point the id, like it does for purchase records;
//   · the reports must read the id FIRST, name match only as a fallback.
// Each of these is a string inside code or SQL — a real database is the full
// proof (npm run test:line-product), this catches the regression in `npm test`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC  = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');
const INV  = readFileSync(join(ROOT, 'public', 'static', 'invoices.js'), 'utf8');
const MIG  = readFileSync(join(ROOT, 'migrations', '0054_invoice_line_product.sql'), 'utf8');

const t = suite('invoice-line-product');

// Slice a function/route body out of a source file, from a marker to the next
// top-level marker, so each check looks only where it should.
function between(src, start, end) {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return src.slice(i, j < 0 ? undefined : j);
}

// ── Migration ────────────────────────────────────────────────────
t.check('0054 adds invoice_lines.generic_product_id',
  /ALTER TABLE invoice_lines ADD COLUMN generic_product_id/.test(MIG));
t.check('0054 has no foreign key (would tie the purge delete order to it)',
  !/generic_product_id TEXT[^;]*REFERENCES/.test(MIG));
t.check('every backfill pass only fills lines still NULL',
  (MIG.match(/UPDATE invoice_lines/g) || []).length === 3 &&
  (MIG.match(/WHERE generic_product_id IS NULL/g) || []).length === 3);
t.check('the backfill refuses ambiguous answers (a count must equal 1)',
  (MIG.match(/\) = 1;/g) || []).length === 2 && /COUNT\(DISTINCT pe\.generic_product_id\)/.test(MIG));

// ── Replace route ────────────────────────────────────────────────
const replace = between(SRC, "app.post('/api/invoice-lines/:invoice_id/replace'", '\napp.');
t.check('replace route writes generic_product_id', /INSERT INTO invoice_lines \([^)]*generic_product_id/.test(replace));
t.check('replace route only keeps ids of this business\'s products',
  /FROM generic_products WHERE id IN[\s\S]*AND org_id IS \?/.test(replace) && /ownIds\.has\(productId\)/.test(replace));
t.check('replace route returns the new line ids', /line_ids:\s*lineIds/.test(replace));

// ── Product import ───────────────────────────────────────────────
const bulk = between(SRC, "app.post('/api/bulk/upsert-products'", '\napp.');
t.check('the import ties the line to the product it filed the purchase under',
  /UPDATE invoice_lines SET generic_product_id = \? WHERE id = \? AND invoice_id = \? AND org_id IS \?/.test(bulk) &&
  /\.bind\(genericId, invoiceLineId, invoiceIdForLine, org\)/.test(bulk));

// ── Merge ────────────────────────────────────────────────────────
const merge = between(SRC, 'async function mergeInto(', '\nasync function ');
t.check('merge re-points invoice lines by id',
  /UPDATE invoice_lines SET generic_product_id = \? WHERE generic_product_id = \? AND org_id IS \?/.test(merge) &&
  /\.bind\(surviving\.id, merged\.id, org\)/.test(merge));

// ── Reports read the id first ────────────────────────────────────
const idFirst = /COALESCE\(\s*\(SELECT gp\.category FROM generic_products gp\s+WHERE gp\.id = il\.generic_product_id AND gp\.org_id IS \?\)/;
const breakdown = between(SRC, "app.get('/api/spending-breakdown'", '\napp.');
const pnl       = between(SRC, "app.get('/api/pnl'", '\napp.');
t.check('spending breakdown found', breakdown.length > 0);
t.check('spending breakdown resolves the category by line product id first', idFirst.test(breakdown));
t.check('P&L resolves the category by line product id first', idFirst.test(pnl));

// ── Browser: both save paths ─────────────────────────────────────
const confirm = between(INV, 'async function confirmAndSaveInvoice()', '\nasync function ');
t.check('Confirm & Save keeps the reviewer\'s product link on each line',
  /_link_product_id:\s*l\._link_product_id/.test(confirm) && /_link_product_name:\s*l\._link_product_name/.test(confirm));
t.check('Confirm & Save passes each new line id to the import',
  /const linesResult = await apiPost\(`invoice-lines\/\$\{id\}\/replace`/.test(confirm) &&
  /invoice_line_id:\s*lineIds\[i\]/.test(confirm));

const edit = between(INV, 'async function saveInvDetail()', '\nasync function ');
t.check('editing a saved invoice sends each line\'s product id back',
  /generic_product_id:\s*l\.generic_product_id/.test(edit));

t.done();
