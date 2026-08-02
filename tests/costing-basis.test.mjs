// Which price a cost is based on — public/static/utils.js
//
// FIFO only means something when the app knows how much has been used: it picks
// the price layer by comparing what was bought against what is left. With no
// consumption ever recorded those are equal, so FIFO concludes nothing has been
// touched and pins every cost to the FIRST invoice ever uploaded. That number
// then never moves however many deliveries arrive, while looking entirely
// plausible. Two rules avoid that:
//
//   Essential -> always the latest invoice. Stock tracking is not in the plan,
//                so FIFO has nothing to work from.
//   Pro       -> FIFO, but fall back to the latest invoice for any product with
//                no consumption recorded (a Pro account that has not connected a
//                till or done a count yet). The fallback switches itself off the
//                moment real usage lands.
//
// The second rule is why this is not a plain plan check: it also protects the
// window just after an upgrade, where a plan check would swap a working
// latest-invoice cost for a FIFO one anchored to a months-old first invoice.
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const { buildLiveCostIndex, fifoActiveEntryWithBasis, entryPackFacts } =
  loadBrowserModule(['utils.js'],
    ['buildLiveCostIndex', 'fifoActiveEntryWithBasis', 'entryPackFacts']);

const t = suite('costing-basis');

// Tomatoes bought three times, rising: $3.00, then $4.50, then $6.00 — 20 kg each.
const buy = (date, cpu) => ({
  generic_product_id: 'tom', purchase_date: date, pack_qty: 20, pack_unit: 'kg',
  qty_ordered: 1, cost: cpu * 20, cost_per_unit: cpu,
});
const ENTRIES  = [buy('2026-06-01', 3), buy('2026-07-01', 4.5), buy('2026-08-01', 6)];
const generics = [{ id: 'tom', name: 'Tomatoes', base_unit: 'kg' }];

const index = (onHand, plan) => buildLiveCostIndex({
  generics, entries: ENTRIES, plan,
  inventory: [{ item_id: 'tom', item_type: 'raw_material', quantity: onHand, unit: 'kg' }],
  recipes: [{ id: 'sauce', servings: 5, yield_unit: 'kg' }],
  recipeItems: [{ recipe_id: 'sauce', product_id: 'tom', quantity: 3, unit: 'kg' }],
  finishedProducts: [{ id: 'pizza', selling_price: 12 }],
  fpItems: [{ finished_product_id: 'pizza', item_type: 'recipe', ref_id: 'sauce', quantity: 0.1, unit: 'kg' }],
});
const price = (onHand, plan) => index(onHand, plan).product.get('tom').cost_per_unit;
const basis = (onHand, plan) => index(onHand, plan).product.get('tom').basis;

t.section('Essential: always the latest invoice');
t.check('60 kg on hand (nothing used) -> $6.00', t.near(price(60, 'essential'), 6), `${price(60, 'essential')}`);
t.check('and it says so',                        basis(60, 'essential') === 'latest', basis(60, 'essential'));
// Essential CAN move stock (Produce Batch and Pack Run are not gated), but the
// plan's basis is still the latest invoice — predictable, and one clear reason
// to upgrade rather than a second costing mode nobody asked for.
t.check('45 kg (some used) still $6.00', t.near(price(45, 'essential'), 6), `${price(45, 'essential')}`);
t.check('15 kg (most used) still $6.00', t.near(price(15, 'essential'), 6), `${price(15, 'essential')}`);

t.section('Pro with real consumption: FIFO, untouched');
t.check('used 15 of 60 -> still on the $3.00 sack', t.near(price(45, 'pro'), 3),   `${price(45, 'pro')}`);
t.check('reported as fifo',                          basis(45, 'pro') === 'fifo',  basis(45, 'pro'));
t.check('first sack gone -> $4.50',                  t.near(price(40, 'pro'), 4.5), `${price(40, 'pro')}`);
t.check('used 45 of 60 -> $6.00',                    t.near(price(15, 'pro'), 6),   `${price(15, 'pro')}`);
t.check('out of stock -> $6.00',                     t.near(price(0, 'pro'), 6),    `${price(0, 'pro')}`);

t.section('Pro with NO consumption: falls back, and says so');
// The upgrade window: paid for Pro, till not connected yet, no count done.
t.check('60 kg on hand -> $6.00, not the first invoice',
  t.near(price(60, 'pro'), 6), `${price(60, 'pro')}`);
t.check('and it is NOT anchored to $3.00', !t.near(price(60, 'pro'), 3), `${price(60, 'pro')}`);
t.check('reported as latest', basis(60, 'pro') === 'latest', basis(60, 'pro'));

// Stock typed straight into inventory with no invoice behind it: more on hand
// than was ever bought. No evidence either way, so don't pretend.
t.check('stock exceeding purchases also falls back',
  t.near(price(75, 'pro'), 6) && basis(75, 'pro') === 'latest', `${price(75, 'pro')} ${basis(75, 'pro')}`);

t.section('the basis carries up through recipes and finished products');
const stuck = index(60, 'pro');
const live  = index(45, 'pro');
t.check('recipe inherits latest',           stuck.recipe.get('sauce').basis === 'latest');
t.check('finished product inherits latest', stuck.finished.get('pizza').basis === 'latest');
t.check('recipe reports fifo when it is',   live.recipe.get('sauce').basis === 'fifo');
t.check('finished product reports fifo',    live.finished.get('pizza').basis === 'fifo');
// 3 kg of tomatoes at $6 = $18 for a 5 kg batch; at $3 = $9.
t.check('and the money follows the basis',
  t.near(stuck.recipe.get('sauce').total_cost, 18) && t.near(live.recipe.get('sauce').total_cost, 9),
  `${stuck.recipe.get('sauce').total_cost} vs ${live.recipe.get('sauce').total_cost}`);

t.section('one delivery is not a fallback');
// Nothing to choose between, so don't raise a "priced from your latest invoice"
// note about a product that only has one price.
const single = buildLiveCostIndex({
  generics, entries: [buy('2026-06-01', 3)], plan: 'pro',
  inventory: [{ item_id: 'tom', item_type: 'raw_material', quantity: 20, unit: 'kg' }],
});
t.check('single-invoice product reports fifo',
  single.product.get('tom').basis === 'fifo', single.product.get('tom').basis);

t.section('an unknown or missing plan behaves like Pro');
// Fail safe: the plan arrives asynchronously, so a cost index may be built
// before it is known. Defaulting to FIFO-with-fallback means the worst case is
// a repaint, never a silently wrong basis for a paying Pro account.
t.check('no plan, with consumption -> fifo', t.near(price(45, ''), 3) && basis(45, '') === 'fifo');
t.check('no plan, no consumption  -> latest', t.near(price(60, ''), 6) && basis(60, '') === 'latest');

t.section('the raw picker reports its own basis');
const pick = (onHand, opts) => {
  const r = fifoActiveEntryWithBasis(ENTRIES, onHand, 'kg', null, opts);
  return { price: entryPackFacts(r.entry).cost_per_unit, basis: r.basis };
};
t.check('alwaysLatest overrides real consumption',
  pick(45, { alwaysLatest: true }).price === 6, `${pick(45, { alwaysLatest: true }).price}`);
t.check('without it, consumption wins',
  pick(45).price === 3, `${pick(45).price}`);
t.check('no entries is survivable',
  fifoActiveEntryWithBasis([], 0, 'kg', null).entry === null);

t.done();
