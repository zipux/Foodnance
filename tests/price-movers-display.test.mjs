// Price Movers rescales its payload once, at the data boundary, so every render
// site downstream is correct without knowing anything about units.
//
// The whole point is that three kinds of number live side by side in that
// payload and each needs a DIFFERENT rule. Getting one wrong is silent:
//
//   prices     ($/unit)  multiply   — a wine at $0.02384/ml is $23.84/L
//   quantities (units)   DIVIDE     — 18000 ml bought is 18 L bought, and
//                                     leaving it alone prints "18000 L bought"
//   totals     ($)       untouched  — spend and overpay_est are already money
//
// The quantity rule is the one that bites: it is the only field that moves the
// other way, it sits in the same object as latest_price, and getting it wrong
// inflates a volume by 1000x in a sentence a manager reads as fact.
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const t = suite('price-movers-display');

const { pmRescaleForDisplay, _pmQuote } =
  loadBrowserModule(['utils.js', 'home.js'], ['pmRescaleForDisplay', '_pmQuote']);

// The real Demo Essential payload for the merged Pinot Grigio, as the API
// returns it: a 4 L box and 24 x 750 ml bottles, both bought 2026-05-18.
const PINOT = () => ({
  product_id: 'mskdrn5oyhb54a',
  product_name: 'Pinot Grigio',
  unit: 'ml',
  pct_change: 223.0352,
  cheapest_price: 0.00738,
  overpay_est: 296.28,
  purchases: [
    { vendor: 'BCL', cost_per_stock_unit: 0.02384, cost_per_unit: 0.02384, pack_unit: 'ml' },
    { vendor: 'BCL', cost_per_stock_unit: 0.00738, cost_per_unit: 7.38,    pack_unit: 'L'  },
  ],
  vendors: [{ name: 'BCL', latest_price: 0.02384, qty_stock: 18000, spend: 429.12 }],
});

t.section('the wine reads in litres, not millilitres');
const out = pmRescaleForDisplay(PINOT());
t.check('unit becomes L', out.unit === 'L', out.unit);
t.check('bottles are $23.84/L', Math.abs(out.purchases[0].cost_per_stock_unit - 23.84) < 1e-9,
  `${out.purchases[0].cost_per_stock_unit}`);
t.check('the box is $7.38/L', Math.abs(out.purchases[1].cost_per_stock_unit - 7.38) < 1e-9,
  `${out.purchases[1].cost_per_stock_unit}`);
t.check('cheapest price is $7.38/L', Math.abs(out.cheapest_price - 7.38) < 1e-9, `${out.cheapest_price}`);
t.check('vendor latest price is $23.84/L', Math.abs(out.vendors[0].latest_price - 23.84) < 1e-9);

t.section('quantities go the other way');
t.check('18000 ml bought becomes 18 L bought', out.vendors[0].qty_stock === 18, `${out.vendors[0].qty_stock}`);
t.check('it is NOT multiplied (would be 18,000,000)', out.vendors[0].qty_stock !== 18000000);
t.check('it is NOT left alone (would print "18000 L")', out.vendors[0].qty_stock !== 18000);

t.section('money is money — it does not depend on the unit');
t.check('spend unchanged', out.vendors[0].spend === 429.12, `${out.vendors[0].spend}`);
t.check('overpay_est unchanged', out.overpay_est === 296.28, `${out.overpay_est}`);
t.check('pct_change unchanged', out.pct_change === 223.0352, `${out.pct_change}`);
t.check('the invoiced figure is left for the display layer',
  out.purchases[1].cost_per_unit === 7.38, `${out.purchases[1].cost_per_unit}`);

t.section('a spend total x volume still reconciles after rescaling');
// 18 L at $23.84/L is the $429.12 actually spent — the two rules have to be
// exact inverses or the arithmetic on screen stops adding up.
t.check('18 L x $23.84/L = $429.12',
  Math.abs(out.vendors[0].qty_stock * out.vendors[0].latest_price - 429.12) < 1e-9,
  `${out.vendors[0].qty_stock * out.vendors[0].latest_price}`);

t.section('grams behave the same way');
const g = pmRescaleForDisplay({
  unit: 'g', cheapest_price: 0.0015,
  purchases: [{ cost_per_stock_unit: 0.0168 }],
  vendors: [{ latest_price: 0.0168, qty_stock: 1600, spend: 26.88 }],
});
t.check('unit becomes kg', g.unit === 'kg');
t.check('$0.0168/g is $16.80/kg', Math.abs(g.purchases[0].cost_per_stock_unit - 16.8) < 1e-9);
t.check('1600 g is 1.6 kg', Math.abs(g.vendors[0].qty_stock - 1.6) < 1e-9);
t.check('spend still $26.88', g.vendors[0].spend === 26.88);

t.section('every other unit is returned untouched');
for (const unit of ['kg', 'lb', 'lbs', 'oz', 'L', 'l', 'fl oz', 'gal', 'each', 'case', 'bottle', '']) {
  const src = {
    unit, cheapest_price: 3.55,
    purchases: [{ cost_per_stock_unit: 3.55, cost_per_unit: 3.55, pack_unit: unit }],
    vendors: [{ latest_price: 3.55, qty_stock: 40, spend: 142 }],
  };
  const r = pmRescaleForDisplay(src);
  t.check(`${unit || '(blank)'}: identical object returned`, r === src,
    'a unit that does not rescale must be passed straight through');
}

t.section('missing or null fields do not throw');
t.check('no purchases/vendors arrays', (() => {
  const r = pmRescaleForDisplay({ unit: 'ml', cheapest_price: null });
  return r.unit === 'L' && r.cheapest_price === null
    && Array.isArray(r.purchases) && Array.isArray(r.vendors);
})());
t.check('null price and qty survive as null', (() => {
  const r = pmRescaleForDisplay({
    unit: 'ml', purchases: [{ cost_per_stock_unit: null }],
    vendors: [{ latest_price: null, qty_stock: null }],
  });
  return r.purchases[0].cost_per_stock_unit === null
    && r.vendors[0].latest_price === null && r.vendors[0].qty_stock === null;
})());
t.check('an unconvertible purchase keeps its null', (() => {
  const r = pmRescaleForDisplay(PINOT());
  const src = pmRescaleForDisplay({ unit: 'ml', purchases: [{ cost_per_stock_unit: null, cost_per_unit: 2.5, pack_unit: 'case' }], vendors: [] });
  return src.purchases[0].cost_per_stock_unit === null && r.unit === 'L';
})());
t.check('rescaling twice would double-scale — so it is done once, at load', (() => {
  const once  = pmRescaleForDisplay(PINOT());
  const twice = pmRescaleForDisplay(once);
  return twice === once;   // 'L' does not rescale, so a second pass is a no-op
})(), 'a second pass must be inert, not multiply again');

// ── _pmQuote: label the number with a unit it is actually in ─────
t.section('a purchase is quoted in the unit it is really expressed in');
t.check('a converted purchase uses the group unit',
  _pmQuote({ cost_per_stock_unit: 23.84, cost_per_unit: 0.02384, pack_unit: 'ml' }, 'L') === '$23.84 / L',
  _pmQuote({ cost_per_stock_unit: 23.84, cost_per_unit: 0.02384, pack_unit: 'ml' }, 'L'));
t.check('an UNCONVERTED purchase uses its own pack unit, not the group label',
  _pmQuote({ cost_per_stock_unit: null, cost_per_unit: 12.5, pack_unit: 'case' }, 'kg') === '$12.50 / case',
  _pmQuote({ cost_per_stock_unit: null, cost_per_unit: 12.5, pack_unit: 'case' }, 'kg'));
t.check('...which is the mislabel this replaced ($12.50 / kg was wrong)',
  _pmQuote({ cost_per_stock_unit: null, cost_per_unit: 12.5, pack_unit: 'case' }, 'kg') !== '$12.50 / kg');
t.check('a per-g fallback is still quoted per kg',
  _pmQuote({ cost_per_stock_unit: null, cost_per_unit: 0.0015, pack_unit: 'g' }, 'each') === '$1.50 / kg');
t.check('a missing purchase renders a dash, not a crash', _pmQuote(null, 'kg') === '—');
t.check('a purchase with no unit at all does not throw',
  typeof _pmQuote({ cost_per_stock_unit: null, cost_per_unit: 1 }, '') === 'string');

t.done();
