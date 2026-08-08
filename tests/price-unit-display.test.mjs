// A per-unit PRICE must be shown in a unit big enough to hold real money, on
// EVERY page that shows one — not just recipes and finished products.
//
// utils.js already has the helper (scalePriceUnit / fmtUnitCost) and
// tests/unit-cost-display.test.mjs already proves the helper itself is right.
// What was never checked is ADOPTION: Price Movers (home.js) and the Products
// list (products.js) format with the raw fmt(), so a wine bought at $23.84/L
// reads "$0.02 / ml" and a flour at $1.50/kg reads "$0.00 / g".
//
// The point of this file is the OTHER units. Rescaling g and ml is easy to get
// right and easy to over-apply: quote kg per tonne, or "each" per hundred, and
// every price on the site moves. So the sweep below walks every unit the app
// knows plus the ones it doesn't, and pins that EXACTLY TWO of them rescale.
//
// Red until the two pages adopt the helper; the sweep sections pass today and
// must keep passing after.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = suite('price-unit-display');

const { scalePriceUnit, fmtUnitCost, priceUnitLabel, fmt } = loadBrowserModule(
  ['utils.js'], ['scalePriceUnit', 'fmtUnitCost', 'priceUnitLabel', 'fmt'],
);

// Every unit the conversion table knows, plus count units and free-text units a
// supplier might invoice in. `want` is the unit the PRICE should be quoted in.
const UNITS = [
  // unit,     rescales?, price unit
  ['kg',       false, 'kg'],
  ['g',        true,  'kg'],
  ['lb',       false, 'lb'],
  ['lbs',      false, 'lbs'],
  ['oz',       false, 'oz'],
  ['L',        false, 'L'],
  ['ml',       true,  'L'],
  ['fl oz',    false, 'fl oz'],
  ['gal',      false, 'gal'],
  ['each',     false, 'each'],
  ['unit',     false, 'unit'],
  ['case',     false, 'case'],
  ['bag',      false, 'bag'],
  ['bottle',   false, 'bottle'],
  ['tray',     false, 'tray'],
  ['dozen',    false, 'dozen'],
];

t.section('exactly two units rescale — every other unit is left alone');
for (const [unit, rescales, want] of UNITS) {
  const s = scalePriceUnit(1, unit);
  const moved = s.cost !== 1;
  t.check(`${unit}: ${rescales ? 'rescales' : 'untouched'}`, moved === rescales,
    `cost ${s.cost}, unit ${s.unit}`);
  t.check(`${unit}: price quoted per ${want}`, s.unit === want, s.unit);
}
t.check('only g and ml rescale, nothing else',
  UNITS.filter(([u]) => scalePriceUnit(1, u).cost !== 1).map(([u]) => u).join(',') === 'g,ml');

t.section('the rescale factor is exactly 1000, never approximate');
t.check('g -> kg is x1000', scalePriceUnit(0.0015, 'g').cost === 1.5, `${scalePriceUnit(0.0015, 'g').cost}`);
t.check('ml -> L is x1000', scalePriceUnit(0.005551, 'ml').cost === 5.551, `${scalePriceUnit(0.005551, 'ml').cost}`);
t.check('kg is x1 (identity)', scalePriceUnit(7.85, 'kg').cost === 7.85);
t.check('lb is x1 (identity)', scalePriceUnit(3.552, 'lb').cost === 3.552);
t.check('each is x1 (identity)', scalePriceUnit(12.5, 'each').cost === 12.5);

t.section('label and number always agree');
for (const [unit] of UNITS) {
  const s = scalePriceUnit(1, unit);
  t.check(`${unit}: priceUnitLabel matches scalePriceUnit`, priceUnitLabel(unit) === s.unit,
    `${priceUnitLabel(unit)} vs ${s.unit}`);
}

t.section('case and whitespace do not defeat the rescale');
for (const v of ['G', ' g ', 'ML', 'mL', ' ml']) {
  const s = scalePriceUnit(0.002, v);
  t.check(`"${v}" still rescales`, s.cost === 2, `${s.cost} ${s.unit}`);
}
t.check('"L" is not confused for "ml"', scalePriceUnit(7.38, 'L').cost === 7.38);
t.check('"l" lowercase is also left alone', scalePriceUnit(7.38, 'l').cost === 7.38);
t.check('"kg" is not confused for "g"', scalePriceUnit(7.85, 'kg').cost === 7.85);
t.check('"KG" is not confused for "g"', scalePriceUnit(7.85, 'KG').cost === 7.85);
t.check('"gal" is not confused for "g"', scalePriceUnit(9.99, 'gal').cost === 9.99);
t.check('"fl oz" is not confused for "oz"', priceUnitLabel('fl oz') === 'fl oz');

// The whole reason the helper exists.
t.section('no realistic price is ever displayed as $0.00');
const REAL = [
  ['flour',            0.0015,     'g',  '$1.50 / kg'],
  ['salt in a sack',   0.000032,   'g',  '$0.03 / kg'],
  ['Heineken 0.0',     0.005551,   'ml', '$5.55 / L'],
  ['Peroni',           0.006763,   'ml', '$6.76 / L'],
  ['sparkling water',  0.014933,   'ml', '$14.93 / L'],
  ['Pinot Grigio btl', 0.023840,   'ml', '$23.84 / L'],
  ['Pinot Grigio box', 7.38,       'L',  '$7.38 / L'],
  ['prosciutto',       37.692308,  'kg', '$37.69 / kg'],
  // 0.985 displays as $0.98, not $0.99: toFixed(2) rounds the binary
  // representation of .5 down, where Math.round(x*100)/100 rounds it up. A
  // cosmetic penny in the display layer only — pinned so it is a known quantity
  // rather than a surprise, and NOT something to "fix" by rounding twice.
  ['red onions',       0.985,      'kg', '$0.98 / kg'],
  ['sliced onion',     3.552,      'lb', '$3.55 / lb'],
];
for (const [name, cpu, unit, want] of REAL) {
  t.check(`${name}: ${want}`, fmtUnitCost(cpu, unit) === want, fmtUnitCost(cpu, unit));
}
t.check('none of them read $0.00',
  REAL.every(([, cpu, unit]) => !fmtUnitCost(cpu, unit).startsWith('$0.00 ')));
// Two distinct ways the raw formatter fails, both currently live on Price Movers.
t.check('raw fmt() prints the two per-gram prices as $0.00 — "free"',
  REAL.filter(([, cpu]) => fmt(cpu) === '$0.00').map(r => r[0]).join(', ') === 'flour, salt in a sack',
  `${REAL.filter(([, cpu]) => fmt(cpu) === '$0.00').map(r => r[0]).join(', ')}`);
t.check('and squashes four different per-ml wines into two indistinguishable pennies',
  new Set(REAL.filter(([, , u]) => u === 'ml').map(([, cpu]) => fmt(cpu))).size === 2,
  REAL.filter(([, , u]) => u === 'ml').map(([n, cpu]) => `${n}=${fmt(cpu)}`).join(', '));
t.check('the same four are all distinct once scaled',
  new Set(REAL.filter(([, , u]) => u === 'ml').map(([, cpu, u]) => fmtUnitCost(cpu, u))).size === 4);

t.section('degenerate input does not throw or invent a unit');
t.check('empty unit is a string', typeof fmtUnitCost(2.5, '') === 'string');
t.check('null unit is a string', typeof fmtUnitCost(2.5, null) === 'string');
t.check('zero cost renders', fmtUnitCost(0, 'kg') === '$0.00 / kg');
t.check('NaN cost renders', fmtUnitCost(NaN, 'g').startsWith('$0.00'));
t.check('unknown unit passes through unscaled', fmtUnitCost(2.5, 'case') === '$2.50 / case');

// ── Adoption: the pages that show a per-unit price must use the helper ──
// Currently only recipes.js and finished-products.js do. These two are the gap
// the user actually hit: Price Movers quoting wine per millilitre.
t.section('every page that shows a per-unit price uses the scaling helper');
const PAGES = [
  ['home.js',              'Price Movers'],
  ['products.js',          'Products list'],
  ['recipes.js',           'recipe ingredient costs'],
  ['finished-products.js', 'finished product costs'],
];
for (const [file, what] of PAGES) {
  const src = readFileSync(join(ROOT, 'public/static', file), 'utf8');
  const uses = /fmtUnitCost|scalePriceUnit|priceUnitLabel/.test(src);
  t.check(`${file} (${what}) quotes prices in a readable unit`, uses,
    'formats per-unit prices with the raw fmt() — a per-ml price will read $0.00 or $0.02');
}

t.done();
