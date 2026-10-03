// Two purchases of one product on the SAME day — which is "the latest"?
//
// One rule everywhere: the one entered last. Before this, each page broke the
// tie its own way (a comparator that answered -1 for equal dates), so the
// Products page showed the purchase entered FIRST as the latest price while
// recipes were costed from the one entered LAST — olive oil at $7.95 on one
// screen and $8.80 on the other. Price Movers tied on created_at, which is the
// same second for every line of one invoice, so its pick was arbitrary.
//
// Behavioural test of the shared helpers plus a static audit: no page may sort
// purchases with its own date comparator again, and the server must break the
// tie by entry order (rowid), not created_at.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { purchasesOldestFirst, purchasesNewestFirst, buildLiveCostIndex } =
  loadBrowserModule(['utils.js'], ['purchasesOldestFirst', 'purchasesNewestFirst', 'buildLiveCostIndex']);

const t = suite('same-day-purchases');
const eq = (label, actual, expected) => t.check(label, actual === expected, `got ${actual}`);

const mk = (id, date, cpu) => ({
  id, generic_product_id: 'oil', purchase_date: date, pack_qty: 1, pack_unit: 'L',
  qty_ordered: 1, cost: cpu, cost_per_unit: cpu,
});
// As the server lists them: most recently entered first.
const server = [mk('third', '2026-09-20', 8.80), mk('second', '2026-09-20', 7.95), mk('first', '2026-09-01', 7.00)];
const ids = (l) => l.map(e => e.id).join(',');

t.section('the shared order');
eq('oldest first: earlier day, then same-day in entry order', ids(purchasesOldestFirst(server)), 'first,second,third');
eq('newest first is the exact reverse', ids(purchasesNewestFirst(server)), 'third,second,first');
eq('the latest purchase is the one entered last', purchasesNewestFirst(server)[0].cost_per_unit, 8.80);
eq('the input is not reordered', ids(server), 'third,second,first');
eq('a later date still beats a later entry',
  ids(purchasesNewestFirst([mk('backdated', '2026-08-01', 1), mk('recent', '2026-09-20', 2)])), 'recent,backdated');
const noDate = [{ id: 'b', created_at: '2026-09-20 10:00:00' }, { id: 'a', created_at: '2026-09-19 10:00:00' }];
eq('a custom date (purchase_date, else created_at) is honoured',
  ids(purchasesNewestFirst(noDate, e => e.purchase_date || e.created_at || '')), 'b,a');

t.section('costing agrees with it');
for (const plan of ['essential', 'pro']) {
  const idx = buildLiveCostIndex({ generics: [{ id: 'oil', name: 'Olive Oil', base_unit: 'L' }], entries: server, plan });
  eq(`${plan}: the product is priced from the purchase entered last`, idx.product.get('oil').cost_per_unit, 8.80);
}

t.section('no page sorts purchases its own way');
for (const f of ['utils.js', 'products.js', 'recipes.js', 'finished-products.js', 'inventory.js']) {
  const src = readFileSync(join(ROOT, 'public', 'static', f), 'utf8');
  t.check(`${f} has no hand-written purchase_date comparator`,
    !/\.sort\([^\n]*purchase_date[^\n]*\?\s*1\s*:\s*-1/.test(src));
}
const server_ts = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');
t.check('Price Movers breaks a same-day tie by entry order', /ORDER BY pe\.purchase_date DESC, pe\.rowid DESC/.test(server_ts));
t.check('nothing on the server breaks the tie by created_at', !/purchase_date[^\n]*\n?[^\n]*created_at DESC|created_at \|\| ''\)\.localeCompare/.test(server_ts));
t.check('stock-take pricing reads purchases in entry order', /voided_at IS NULL\s+ORDER BY rowid DESC/.test(server_ts));

t.done();
