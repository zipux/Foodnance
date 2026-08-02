// Voided invoice lines must not price anything — public/static/*.js
//
// Voiding an invoice sets voided_at on the product_entries it created,
// specifically so they stop counting toward pricing (see CLAUDE.md, "Soft-delete
// / void, never hard-delete history"). buildLiveCostIndex honoured that from the
// start; the page catalogues did not, so the Finished Products LIST showed one
// cost and its EDIT FORM showed another for the same product at the same moment.
//
// A voided entry is doubly wrong if left in: it can be selected as the active
// price layer, AND it inflates the total-purchased figure, which shifts the FIFO
// layer to the wrong one even when the voided entry isn't the one chosen.
//
// This is a static audit as well as a behavioural test: it reads the shipped
// sources and fails if a costing page reintroduces an unfiltered entry filter.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const STATIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'static');
const { buildLiveCostIndex, fifoActiveEntryIn, entryPackFacts } =
  loadBrowserModule(['utils.js'], ['buildLiveCostIndex', 'fifoActiveEntryIn', 'entryPackFacts']);

const t = suite('voided-entries');

// June $0.90, July $1.80 (VOIDED), August $3.60 — 10 kg each.
const mk = (date, cpu, voided) => ({
  generic_product_id: 'f', purchase_date: date, pack_qty: 10, pack_unit: 'kg',
  qty_ordered: 1, cost: cpu * 10, cost_per_unit: cpu, ...(voided ? { voided_at: '2026-07-05' } : {}),
});
const entries  = [mk('2026-06-01', 0.9), mk('2026-07-01', 1.8, true), mk('2026-08-01', 3.6)];
const generics = [{ id: 'f', name: 'Flour', base_unit: 'kg' }];
const liveCost = (onHand) => buildLiveCostIndex({
  generics, entries,
  inventory: [{ item_id: 'f', item_type: 'raw_material', quantity: onHand, unit: 'kg' }],
}).product.get('f').cost_per_unit;

t.section('a cancelled invoice never sets the price');
t.check('15 kg on hand -> $0.90, not the voided $1.80', t.near(liveCost(15), 0.9), `${liveCost(15)}`);
t.check('the voided layer is skipped entirely once the cheap stock is gone',
  t.near(liveCost(5), 3.6), `${liveCost(5)}`);
t.check('a voided price is never returned at any stock level',
  [20, 15, 12, 10, 8, 5, 2, 0].every(q => !t.near(liveCost(q), 1.8)),
  JSON.stringify([20, 15, 12, 10, 8, 5, 2, 0].map(q => [q, liveCost(q)])));

t.section('and it does not distort which layer is active');
// With the voided 10 kg wrongly counted, 30 kg looks purchased instead of 20,
// so 15 on hand reads as 15 consumed and lands on the July layer. That was the
// exact divergence between the list and the edit form.
const wrong = entryPackFacts(fifoActiveEntryIn(
  entries.slice().sort((a, b) => (a.purchase_date || '') > (b.purchase_date || '') ? 1 : -1),
  15, 'kg', null)).cost_per_unit;
t.check('leaving voided rows in really does pick a different layer',
  !t.near(wrong, 0.9), `unfiltered picked ${wrong}`);
t.check('filtering them out picks the correct one', t.near(liveCost(15), 0.9));

t.section('the costing pages all filter voided entries');
// Static audit: any page that derives a price from product_entries must exclude
// voided rows. Keeps the four pages from drifting apart again.
for (const file of ['recipes.js', 'finished-products.js', 'inventory.js']) {
  const src = readFileSync(join(STATIC, file), 'utf8');
  const filters = src.match(/\.filter\(e => e\.generic_product_id === [^)]*\)/g) || [];
  t.check(`${file} has at least one entry filter`, filters.length > 0, `${filters.length}`);
  t.check(`${file} filters voided on every one`,
    filters.every(f => f.includes('voided_at')),
    filters.filter(f => !f.includes('voided_at')).join(' | ') || 'ok');
}

// products.js legitimately keeps ONE unfiltered filter: the entries table inside
// the product modal lists voided rows so they can be seen and restored. Pin the
// price-bearing paths instead of the whole file.
const prod = readFileSync(join(STATIC, 'products.js'), 'utf8');
t.check('products.js list row filters voided (it shows a cost per unit)',
  /tbody\.innerHTML = slice\.map\(g => \{[\s\S]{0,400}?generic_product_id === g\.id && !e\.voided_at/.test(prod));
t.check('products.js still shows voided rows in the entries table',
  /function renderEntriesTable[\s\S]{0,300}?generic_product_id === genericId\)/.test(prod),
  'the modal table must keep listing voided entries so they can be restored');

t.section('a fully voided product has no price at all');
const allVoid = buildLiveCostIndex({
  generics: [{ id: 'v', name: 'V', base_unit: 'kg' }],
  entries: [{ generic_product_id: 'v', purchase_date: '2026-07-01', pack_qty: 1, pack_unit: 'kg', cost: 50, cost_per_unit: 50, voided_at: '2026-07-02' }],
  inventory: [{ item_id: 'v', item_type: 'raw_material', quantity: 5, unit: 'kg' }],
});
t.check('cost is 0, not the voided $50',
  allVoid.product.get('v').cost_per_unit === 0, `${allVoid.product.get('v').cost_per_unit}`);
t.check('and it is marked unpriced', allVoid.product.get('v').priced === false);

t.done();
