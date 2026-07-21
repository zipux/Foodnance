// FIFO layer selection — public/static/utils.js
//
// Decides which past purchase the stock on hand is currently being drawn from,
// which is the price recipes and inventory valuation use. Purchases must be
// converted to one unit before they're summed: adding a supplier's 50 lb sacks
// to another's 10 kg bags inflates the total, which shifts "how much has been
// consumed", which picks the wrong batch — and so the wrong price.
//
// recipes.js, finished-products.js and inventory.js all delegate here. They
// used to carry their own copies and had drifted (inventory.js ignored
// qty_ordered entirely), so this suite guards the single implementation.
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const { fifoActiveEntryIn, fifoEntryQtyIn } =
  loadBrowserModule(['utils.js'], ['fifoActiveEntryIn', 'fifoEntryQtyIn']);

const t = suite('fifo');

// Oldest first, as callers sort them.
//   Yen     — 5 bags  x 10 kg = 50 kg
//   Neptune — 2 sacks x 50 lb = 100 lb = 45.359 kg
// Real total 95.359 kg; the pre-fix code summed 50 + 100 = 150.
const yen     = { pack_qty: 10, qty_ordered: 5, pack_unit: 'kg', purchase_date: '2026-07-01', vendor: 'Yen' };
const neptune = { pack_qty: 50, qty_ordered: 2, pack_unit: 'lb', purchase_date: '2026-07-10', vendor: 'Neptune' };
const entries = [yen, neptune];

const vendorOf = e => (e ? e.vendor : null);

t.section('Per-entry quantity, converted into the stocking unit');
t.check('Yen 5 x 10 kg = 50 kg',  t.near(fifoEntryQtyIn(yen, 'kg', null), 50));
t.check('Neptune 2 x 50 lb = 45.359 kg (not 100)',
  t.near(fifoEntryQtyIn(neptune, 'kg', null), 45.359237),
  String(fifoEntryQtyIn(neptune, 'kg', null)));
t.check('qty_ordered is respected (inventory.js used to ignore it)',
  t.near(fifoEntryQtyIn({ pack_qty: 5, qty_ordered: 3, pack_unit: 'kg' }, 'kg', null), 15));
t.check('legacy pack_size string still parses',
  t.near(fifoEntryQtyIn({ pack_size: '10 kg', qty_ordered: 2 }, 'kg', null), 20));

t.section('Which batch is being drawn');
// 95.359 total - 60 on hand = 35.359 consumed; Yen's 50 kg still covers it.
// The unconverted sum (150 - 60 = 90) would wrongly say Neptune.
t.check('60 kg on hand -> still on Yen stock',
  vendorOf(fifoActiveEntryIn(entries, 60, 'kg', null)) === 'Yen',
  String(vendorOf(fifoActiveEntryIn(entries, 60, 'kg', null))));
t.check('20 kg on hand -> moved on to Neptune',
  vendorOf(fifoActiveEntryIn(entries, 20, 'kg', null)) === 'Neptune');

t.section('Boundaries');
t.check('nothing consumed -> oldest layer',
  vendorOf(fifoActiveEntryIn(entries, 95.359237, 'kg', null)) === 'Yen');
t.check('all consumed -> newest layer',
  vendorOf(fifoActiveEntryIn(entries, 0, 'kg', null)) === 'Neptune');
t.check('negative stock -> newest layer',
  vendorOf(fifoActiveEntryIn(entries, -5, 'kg', null)) === 'Neptune');
t.check('no entries -> null', fifoActiveEntryIn([], 10, 'kg', null) === null);
t.check('single entry -> that entry',
  vendorOf(fifoActiveEntryIn([yen], 5, 'kg', null)) === 'Yen');

t.section('Purchases that cannot be converted are skipped, never guessed');
const odd = { pack_qty: 6, qty_ordered: 1, pack_unit: 'each', purchase_date: '2026-07-20', vendor: 'Odd' };
t.check('each with no average weight -> null quantity',
  fifoEntryQtyIn(odd, 'kg', null) === null);
t.check('skipped entry does not distort the walk',
  vendorOf(fifoActiveEntryIn([yen, neptune, odd], 60, 'kg', null)) === 'Yen');
t.check('each WITH an average weight converts',
  t.near(fifoEntryQtyIn(odd, 'kg', 0.5), 3));
t.check('all unconvertible -> falls back to newest rather than nothing',
  vendorOf(fifoActiveEntryIn([odd], 5, 'kg', null)) === 'Odd');

t.section('No declared unit -> unchanged legacy behaviour');
t.check('raw quantity used', t.near(fifoEntryQtyIn(neptune, '', null), 100));

t.done();
