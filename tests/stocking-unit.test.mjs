// A product created by invoice import has no declared stocking unit.
//
// `INSERT INTO generic_products (id, name, category, sub_unit_name, sub_unit_qty,
// org_id)` never sets base_unit, so every product created since migration 0032
// backfilled the old ones has come out blank — 18 of 30 in Demo Essential, 8 of
// 10 in Fratelli when measured on 2026-08-08. Blank means /api/price-movers has
// no lens to price purchases through, so it falls back to *whichever purchase
// sorts first*: `stockUnit = String(r.stock_unit || '').trim() || packUnit`.
// That is how a wine bought as a 4 L box and as 750 ml bottles ended up quoted
// per millilitre — the bottles were written four seconds later, so they won.
//
// Fix 1 is to write the unit at import. The risk it carries is NOT the products
// it fixes, it is the ~140 entries in other units it touches on the way past:
// declaring a stocking unit changes the lens EVERY purchase is priced through.
// So the invariant sections below are the real content of this file:
//
//   A. Converting a price between units must never change the PERCENTAGE a
//      customer sees. Absolute numbers move; "up 12%" must not.
//   B. Declaring a unit must never make two purchases LESS comparable than
//      leaving it blank, or the chart silently empties.
//
// Both run against the real convertUnitCost lifted out of src/index.ts, and both
// pass today — they are here to fail if Fix 1 gets them wrong.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = suite('stocking-unit');

const backendSrc = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');

// Handles multi-line signatures, which convertUnitCost has.
function extractFn(name) {
  const m = backendSrc.match(new RegExp(`^function ${name}\\s*\\([\\s\\S]*?^\\}`, 'm'));
  if (!m) throw new Error(`could not find top-level function ${name}() in src/index.ts`);
  const b = m[0];
  const open  = b.indexOf('(');
  const brace = b.indexOf('{', open);
  const close = b.lastIndexOf(')', brace);
  const params = b.slice(open + 1, close).split(',').map(p => p.split(':')[0].trim()).filter(Boolean);
  return `function ${name}(${params.join(', ')}) ${b.slice(brace)}`;
}

const unitTable = backendSrc.match(/^const UNIT_FACTORS[^=]*= \{[\s\S]*?^\}/m);
if (!unitTable) throw new Error('could not find UNIT_FACTORS in src/index.ts');

const { convertUnitCost, normalizeUnit, UNIT_FACTORS } = new Function([
  unitTable[0].replace(/^const UNIT_FACTORS[^=]*=/, 'const UNIT_FACTORS ='),
  extractFn('unitInfo'),
  extractFn('sameUnitName'),
  extractFn('isEachUnit'),
  extractFn('convertUnitCost'),
  extractFn('normalizeUnit'),
  'return { convertUnitCost, normalizeUnit, UNIT_FACTORS };',
].join('\n'))();

const WEIGHT = ['kg', 'g', 'lb', 'lbs', 'oz'];
const VOLUME = ['l', 'ml', 'fl oz', 'gal'];

// ── A. Percentages must survive any change of lens ───────────────
// This is the guarantee that makes Fix 1 safe. Declaring a stocking unit
// re-prices every purchase into that unit; if the arithmetic were lossy or
// asymmetric, every percentage on Price Movers would shift.
t.section('A. changing the lens never changes the percentage');
const PAIRS = [
  ['prev 7.38/L vs latest 23.84/L', 7.38, 'l', 23.84, 'l'],
  ['box vs bottles, mixed units',   7.38, 'l', 0.02384, 'ml'],
  ['kg vs lb supplier switch',      2.20, 'kg', 1.00, 'lb'],
  ['g vs kg same goods',            0.0015, 'g', 1.60, 'kg'],
  ['oz vs lb',                      0.25, 'oz', 3.90, 'lb'],
  ['gal vs L',                      9.99, 'gal', 2.75, 'l'],
];
for (const [label, prevCost, prevUnit, latestCost, latestUnit] of PAIRS) {
  const dim = UNIT_FACTORS[prevUnit].dim;
  const targets = (dim === 'weight' ? WEIGHT : VOLUME);
  const pcts = targets.map(target => {
    const p = convertUnitCost(prevCost, prevUnit, target, null);
    const l = convertUnitCost(latestCost, latestUnit, target, null);
    return (p && l) ? ((l - p) / p) * 100 : null;
  }).filter(v => v !== null);
  const spread = Math.max(...pcts) - Math.min(...pcts);
  t.check(`${label}: same % through all ${pcts.length} lenses`, spread < 1e-9,
    `spread ${spread}, values ${pcts.map(v => v.toFixed(4)).join(' / ')}`);
}

t.section('A2. and the absolute numbers convert exactly, both directions');
for (const [from, to, factor] of [
  ['l', 'ml', 0.001], ['ml', 'l', 1000], ['kg', 'g', 0.001], ['g', 'kg', 1000],
]) {
  const got = convertUnitCost(1, from, to, null);
  t.check(`$1/${from} is $${factor}/${to}`, Math.abs(got - factor) < 1e-12, `${got}`);
}
t.section('A3. a round trip returns the original price');
for (const [a, b] of [['l', 'ml'], ['kg', 'g'], ['lb', 'kg'], ['oz', 'g'], ['gal', 'l'], ['fl oz', 'ml']]) {
  for (const cost of [0.0015, 0.02384, 3.552, 7.38, 37.692308]) {
    const round = convertUnitCost(convertUnitCost(cost, a, b, null), b, a, null);
    t.check(`${cost}/${a} -> ${b} -> ${a}`, Math.abs(round - cost) < 1e-9, `${round}`);
  }
}

// ── B. Declaring a unit must not reduce comparability ────────────
t.section('B. same-dimension units always compare');
for (const list of [WEIGHT, VOLUME]) {
  for (const from of list) {
    for (const to of list) {
      t.check(`${from} -> ${to} is comparable`, convertUnitCost(5, from, to, null) !== null);
    }
  }
}
t.section('B2. cross-dimension is refused, not guessed');
for (const w of WEIGHT) {
  for (const v of VOLUME) {
    t.check(`${w} -> ${v} refuses`, convertUnitCost(5, w, v, null) === null);
    t.check(`${v} -> ${w} refuses`, convertUnitCost(5, v, w, null) === null);
  }
}
t.check('a refusal is null, never 0 — a 0 would read as a free ingredient',
  [['kg', 'l'], ['ml', 'oz'], ['each', 'kg']].every(([a, b]) => convertUnitCost(5, a, b, null) === null));

// The trap Fix 1 could walk into: choosing a count unit as the stocking unit for
// a product invoiced by weight. Without an average weight there is no bridge, so
// every purchase becomes uncomparable and the chart empties. price-movers has a
// fallback for exactly this (it re-picks a unit at least two purchases share) —
// these pin the conditions that fallback exists to handle.
t.section('B3. each <-> weight needs an average weight');
t.check('each -> kg with no avg weight refuses', convertUnitCost(5, 'each', 'kg', null) === null);
t.check('kg -> each with no avg weight refuses', convertUnitCost(5, 'kg', 'each', null) === null);
t.check('each -> kg WITH avg weight converts', convertUnitCost(5, 'each', 'kg', 0.5) === 10,
  `${convertUnitCost(5, 'each', 'kg', 0.5)}`);
t.check('kg -> each WITH avg weight converts', convertUnitCost(10, 'kg', 'each', 0.5) === 5,
  `${convertUnitCost(10, 'kg', 'each', 0.5)}`);
t.check('each -> ml refuses even with an avg weight (weight is not volume)',
  convertUnitCost(5, 'each', 'ml', 0.5) === null);
t.check('an unknown unit never converts', convertUnitCost(5, 'case', 'kg', null) === null);
t.check('same unit is always free, even if unknown', convertUnitCost(5, 'case', 'case', null) === 5);

// ── C. Which unit Fix 1 should write ─────────────────────────────
// The safest version of Fix 1 does not invent a policy: it persists the guess
// the Products page ALREADY makes for a blank base_unit (_inferStockUnit — the
// newest live entry's pack unit), so nothing on screen moves, the guess simply
// stops being re-made differently in three places.
t.section('C. casing must match the units master list');
t.check('L stays uppercase L', normalizeUnit('L') === 'L');
t.check('l becomes L', normalizeUnit('l') === 'L');
t.check('ML becomes ml', normalizeUnit('ML') === 'ml');
t.check('KG becomes kg', normalizeUnit('KG') === 'kg');
t.check('a stored lowercase "l" would NOT match the master list entry "L"',
  'l' !== normalizeUnit('l'),
  'the frontend _inferStockUnit lowercases; the server must normalizeUnit instead');

// A wrong-cased stocking unit is not cosmetic: it is what the price lens is
// looked up by, and what the units picker compares against.
t.section('C2. the lens still works whatever the casing');
for (const [a, b] of [['L', 'ml'], ['l', 'ml'], ['ML', 'L'], ['Kg', 'g']]) {
  t.check(`${a} -> ${b} converts regardless of case`, convertUnitCost(1, a, b, null) !== null);
}

t.section('C3. the contract for the import-side unit');
// stockUnitFor delegates to normalizeUnit, so both are lifted together — the
// point is to run the real pair, not a stand-in for either.
let stockUnitFor = null;
try {
  stockUnitFor = new Function([
    extractFn('normalizeUnit'),
    extractFn('stockUnitFor'),
    'return stockUnitFor;',
  ].join('\n'))();
} catch { /* pending */ }
t.check('stockUnitFor() exists in src/index.ts', stockUnitFor !== null,
  'Fix 1 not implemented yet — import still leaves base_unit blank');
if (stockUnitFor) {
  t.check('a ml pack declares ml', stockUnitFor('ml') === 'ml');
  t.check('an L pack declares L (not lowercase l)', stockUnitFor('L') === 'L');
  t.check('a kg pack declares kg', stockUnitFor('kg') === 'kg');
  t.check('an each pack declares each', stockUnitFor('each') === 'each');
  t.check('a blank pack unit declares nothing — never invent one', stockUnitFor('') === '');
  t.check('an unknown unit is still recorded verbatim', stockUnitFor('case') === 'case');
  t.check('whatever it returns is a valid lens for its own unit',
    ['ml', 'L', 'kg', 'g', 'lb', 'each'].every(u => {
      const s = stockUnitFor(u);
      return !s || convertUnitCost(1, u, s, null) !== null;
    }));
}

// ── D. The live shape this all came from ─────────────────────────
t.section('D. the Pinot Grigio case, end to end');
const BOX    = { cost: 7.38,    unit: 'L' };   // Sawmill Creek 4 L box
const BOTTLE = { cost: 0.02384, unit: 'ml' };  // Verduzzo 750 ml bottles
t.check('through ml: box $0.00738, bottles $0.02384',
  Math.abs(convertUnitCost(BOX.cost, BOX.unit, 'ml', null) - 0.00738) < 1e-9);
t.check('through L: box $7.38, bottles $23.84',
  Math.abs(convertUnitCost(BOTTLE.cost, BOTTLE.unit, 'L', null) - 23.84) < 1e-9);
const pctMl = ((convertUnitCost(BOTTLE.cost, 'ml', 'ml', null) - convertUnitCost(BOX.cost, 'L', 'ml', null))
  / convertUnitCost(BOX.cost, 'L', 'ml', null)) * 100;
const pctL = ((convertUnitCost(BOTTLE.cost, 'ml', 'l', null) - convertUnitCost(BOX.cost, 'L', 'l', null))
  / convertUnitCost(BOX.cost, 'L', 'l', null)) * 100;
t.check('the +223% is the same either way — only the label was unreadable',
  Math.abs(pctMl - pctL) < 1e-9 && Math.abs(pctMl - 223.0352) < 0.001,
  `ml ${pctMl.toFixed(4)}% vs L ${pctL.toFixed(4)}%`);

t.done();
