// Per-unit PRICES are quoted in a unit big enough to hold real money —
// scalePriceUnit / fmtUnitCost in public/static/utils.js.
//
// Bug 4 from the 2026-08-05 pizzeria test: every recipe measured in grams
// displayed "$0.00 / g", because a gram of pizza dough costs about a tenth of a
// cent and fmt() rounds to two places. Pizza Dough really costs $3.21. A cost of
// $0.00 reads as "this ingredient is free", which is the one impression a
// costing app must never give.
//
// The rule is unconditional, not "scale when it would round to zero" — see the
// mixed-list check at the bottom for why.
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const t = suite('unit-cost-display');

const { scalePriceUnit, fmtUnitCost, priceUnitLabel, fmt } = loadBrowserModule(
  ['utils.js'], ['scalePriceUnit', 'fmtUnitCost', 'priceUnitLabel', 'fmt'],
);

// The four recipes from the pizzeria test, with the per-gram figures that all
// showed as $0.00 before this.
const RECIPES = [
  { name: 'Pizza Dough',     total: 3.212,             yield: 2500, want: '$1.28 / kg' },
  { name: 'Tomato Sauce',    total: 5.709664791266159, yield: 2000, want: '$2.85 / kg' },
  { name: 'Carbonara Sauce', total: 15.665750875364814, yield: 1000, want: '$15.67 / kg' },
  { name: 'Tiramisu Base',   total: 12.5580809890827,  yield: 1200, want: '$10.47 / kg' },
];

t.section('a per-gram price is quoted per kg');
for (const r of RECIPES) {
  const perG = r.total / r.yield;
  t.check(`${r.name}: ${r.want} (was ${fmt(perG)} / g)`,
    fmtUnitCost(perG, 'g') === r.want, `got ${fmtUnitCost(perG, 'g')}`);
}
t.check('none of them still read $0.00',
  RECIPES.every(r => !fmtUnitCost(r.total / r.yield, 'g').startsWith('$0.00 ')));

t.section('millilitres are quoted per litre');
// Olive oil at $9.20/L, i.e. $0.0092 per ml — another guaranteed $0.00.
t.check('$0.0092 / ml becomes $9.20 / L', fmtUnitCost(0.0092, 'ml') === '$9.20 / L',
  fmtUnitCost(0.0092, 'ml'));

t.section('units that already hold real money are left alone');
for (const [cost, unit, want] of [
  [3.6,   'lb',   '$3.60 / lb'],
  [7.936, 'kg',   '$7.94 / kg'],
  [0.6,   'each', '$0.60 / each'],
  [0.6,   'oz',   '$0.60 / oz'],
  [9.2,   'L',    '$9.20 / L'],
]) {
  t.check(`${unit} untouched: ${want}`, fmtUnitCost(cost, unit) === want, fmtUnitCost(cost, unit));
}

t.section('the label matches the figure');
t.check('g -> "Cost per kg"',  priceUnitLabel('g')  === 'kg');
t.check('ml -> "Cost per L"',  priceUnitLabel('ml') === 'L');
t.check('kg stays "kg"',       priceUnitLabel('kg') === 'kg');
t.check('each stays "each"',   priceUnitLabel('each') === 'each');
// A label saying "per g" over a per-kg number would be a worse bug than the one
// being fixed: wrong by a factor of 1000 and completely plausible-looking.
t.check('label and value always agree',
  RECIPES.every(r => fmtUnitCost(r.total / r.yield, 'g').endsWith('/ ' + priceUnitLabel('g'))));

t.section('scaling is exactly x1000, not a re-round');
const s = scalePriceUnit(0.0012848, 'g');
t.check('0.0012848 /g -> 1.2848 /kg', Math.abs(s.cost - 1.2848) < 1e-9, String(s.cost));
t.check('and carries the new unit', s.unit === 'kg');

t.section('case and blanks do not break it');
t.check('uppercase G still scales', fmtUnitCost(0.0012848, 'G') === '$1.28 / kg',
  fmtUnitCost(0.0012848, 'G'));
t.check('unknown unit passes through', fmtUnitCost(2.5, 'case') === '$2.50 / case',
  fmtUnitCost(2.5, 'case'));
t.check('missing unit does not throw', typeof fmtUnitCost(2.5, '') === 'string');
t.check('NaN cost still renders', fmtUnitCost(NaN, 'g').startsWith('$0.00'));

// Why the rule is unconditional. A "only when it would round to $0.00" version
// passes every check above — and then quotes these two adjacent list rows in
// units a thousandfold apart, in a column that looks like it holds one kind of
// number. Carbonara at $0.0157/g clears a $0.01 threshold; Pizza Dough does not.
t.section('one list, one unit');
const units = RECIPES.map(r => scalePriceUnit(r.total / r.yield, 'g').unit);
t.check('every gram recipe quotes in the same unit', new Set(units).size === 1,
  units.join(','));

t.done();
