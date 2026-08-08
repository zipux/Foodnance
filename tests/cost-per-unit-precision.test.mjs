// cost_per_unit is a RATE, not a money amount — it must not be rounded to cents.
//
// The AI import path used to store Math.round((cost / totalUnits) * 100) / 100.
// That is harmless at $/kg or $/lb, where a real price has two decimals anyway,
// and ruinous at $/ml or $/g, where a real price is a fraction of a cent. Every
// row below is a REAL entry from the live Demo Essential account on 2026-08-08,
// with the figure that was actually stored:
//
//   Heineken 0.0   $43.96 for 4 x 1980 ml -> $0.005551/ml stored as $0.01  (+80%)
//   Peroni         $107.12 for 8 x 1980 ml -> $0.006763/ml stored as $0.01 (+48%)
//   Sparkling water $112.00 for 10 x 750 ml -> $0.014933/ml stored as $0.01 (-33%)
//
// Worse than any single percentage: anything under half a cent per unit rounds
// to 0.00 and reads downstream as a FREE ingredient. Flour at $1.50/kg is
// $0.0015/g. That is the same silent zero entryPackFacts() deliberately refuses
// to produce for unbridgeable units, arriving through the front door instead.
//
// Two things are pinned here, because fixing the first while breaking the second
// would be worse than the bug:
//
//   1. Fractional-cent rates survive, and rates that were already exact at two
//      decimals do not move by even a floating-point hair.
//   2. The three writers of this column agree. products.js (manual entry) and
//      the unit-conversion cascade already stored full precision, so the import
//      path was the odd one out — the same purchase got a different cost
//      depending on how it was entered.
//
// The backend is TypeScript and tsc is not installed, so unitCostFrom is lifted
// out of src/index.ts by source text — same approach as infer-category and
// pack-size-parity. What runs below is the real shipped function, not a copy; if
// the lift fails the suite fails loudly rather than silently testing nothing.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = suite('cost-per-unit-precision');

const backendSrc = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');

function extractFn(name) {
  const m = backendSrc.match(new RegExp(`^function ${name}\\s*\\([\\s\\S]*?^\\}`, 'm'));
  if (!m) throw new Error(`could not find top-level function ${name}() in src/index.ts`);
  const body   = m[0];
  const nl     = body.indexOf('\n');
  const header = body.slice(0, nl);
  const params = header
    .slice(header.indexOf('(') + 1, header.lastIndexOf(')'))
    .split(',').map(p => p.split(':')[0].trim()).filter(Boolean);
  // Strip the return-type annotation too: `): number {` -> `) {`
  return `function ${name}(${params.join(', ')}) {` + body.slice(nl);
}

const unitCostFrom = new Function(extractFn('unitCostFrom') + '\nreturn unitCostFrom;')();

// The shipped frontend twins.
const { entryPackFacts, fmtUnitCost } =
  loadBrowserModule(['utils.js'], ['entryPackFacts', 'fmtUnitCost']);

// The old behaviour, kept only so the tests can show the difference.
const roundedToCents = (cost, packQty, qtyOrdered) => {
  const totalUnits = packQty * qtyOrdered;
  return totalUnits > 0 ? Math.round((cost / totalUnits) * 100) / 100 : cost;
};

// ── 1. The live rows that were wrong ─────────────────────────────
// name, pack_qty, pack_unit, qty_ordered, cost, what was stored, the truth
const LIVE = [
  ['Heineken 0.0',      1980, 'ml',  4,  43.96, 0.01, 0.005551],
  ['Peroni',            1980, 'ml',  8, 107.12, 0.01, 0.006763],
  ['Sparkling water',    750, 'ml', 10, 112.00, 0.01, 0.014933],
  ['Chopped Tomatoes',   400, 'g',   4,  26.88, 0.02, 0.016800],
  ['Pinot Grigio 750ml', 750, 'ml', 24, 429.12, 0.02, 0.023840],
  ['Rose Wine',          750, 'ml',  2,  26.60, 0.02, 0.017733],
  ['Amaro',              750, 'ml',  1,  33.06, 0.04, 0.044080],
  ['Aperitivo',          750, 'ml',  4,  83.92, 0.03, 0.027973],
];

t.section('real Demo Essential rows now price correctly');
for (const [name, pq, , qo, cost, wasStored, truth] of LIVE) {
  const got = unitCostFrom(cost, pq, qo);
  t.check(`${name}: $${truth}/unit, not the stored $${wasStored}`,
    t.near(got, truth, 1e-6), `got ${got}`);
}

t.section('and the old rounding really did produce those wrong numbers');
// Guards against a test that would pass even with the bug restored.
for (const [name, pq, , qo, cost, wasStored] of LIVE) {
  t.check(`${name}: old code gave $${wasStored}`,
    t.near(roundedToCents(cost, pq, qo), wasStored, 1e-9),
    `got ${roundedToCents(cost, pq, qo)}`);
}

t.section('the error was material, not cosmetic');
const errPct = (was, truth) => Math.abs((was - truth) / truth) * 100;
t.check('Heineken was overstated by ~80%', errPct(0.01, 0.005551) > 79, `${errPct(0.01, 0.005551).toFixed(1)}%`);
t.check('Peroni was overstated by ~48%',   errPct(0.01, 0.006763) > 47, `${errPct(0.01, 0.006763).toFixed(1)}%`);
t.check('Water was understated by ~33%',   errPct(0.01, 0.014933) > 32, `${errPct(0.01, 0.014933).toFixed(1)}%`);

// ── 2. The silent zero ───────────────────────────────────────────
t.section('a cheap ingredient is never free');
// Flour at $1.50/kg, invoiced as a 1000 g bag.
const flourPerG = unitCostFrom(1.50, 1000, 1);
t.check('flour per g is $0.0015, not $0.00', t.near(flourPerG, 0.0015, 1e-9), `${flourPerG}`);
t.check('the old code DID zero it out', roundedToCents(1.50, 1000, 1) === 0, `${roundedToCents(1.50, 1000, 1)}`);
t.check('nothing in the live set rounds to zero under the fix',
  LIVE.every(([, pq, , qo, cost]) => unitCostFrom(cost, pq, qo) > 0));
// Salt at $0.80 for a 25 kg sack, counted in g — the cheapest realistic case.
const saltPerG = unitCostFrom(0.80, 25000, 1);
t.check('salt per g is still a positive price', saltPerG > 0, `${saltPerG}`);
t.check('old code made salt free', roundedToCents(0.80, 25000, 1) === 0);

// ── 3. Nothing that was already right moves ──────────────────────
t.section('prices that divide exactly do not move at all');
t.check('4 bags x 12 lb at $111.84 is still $2.33/lb',
  t.near(unitCostFrom(111.84, 12, 4), 2.33, 1e-9), `${unitCostFrom(111.84, 12, 4)}`);
t.check('the 4L Pinot box is still $7.38/L',
  t.near(unitCostFrom(29.52, 4, 1), 7.38, 1e-9), `${unitCostFrom(29.52, 4, 1)}`);
t.check('a 26 kg salami at $204.10 is still $7.85/kg',
  t.near(unitCostFrom(204.10, 26, 1), 7.85, 1e-9), `${unitCostFrom(204.10, 26, 1)}`);
t.check('a single each-priced item is unchanged',
  t.near(unitCostFrom(12.50, 1, 1), 12.50, 1e-9));
t.check('identical to the old code on every exact case',
  [[111.84, 12, 4], [29.52, 4, 1], [204.10, 26, 1], [12.50, 1, 1]]
    .every(([c, pq, qo]) => unitCostFrom(c, pq, qo) === roundedToCents(c, pq, qo)));

// The honest part. Where the true rate has more than two decimals the stored
// number DOES change — that is the entire point. What matters is the size and
// the direction of the change, and both are bounded by construction: rounding
// to cents can never have moved a value by more than half a cent, so undoing it
// cannot either. Measured across all 143 non-ml/g entries in live production on
// 2026-08-08, the largest movement was exactly $0.005/unit: 0.51% on $/kg,
// 0.15% on $/lb, 0.09% on $/L, 2.70% on the cheapest $/each row. Nothing there
// is a price anyone would notice; every one of them moves TOWARD the invoice.
t.section('inexact prices move toward the truth, by at most half a cent');
const drift = (c, pq, qo) => Math.abs(unitCostFrom(c, pq, qo) - roundedToCents(c, pq, qo));
t.check('3 bags x 5 lb at $53.28 is $3.552/lb, was stored $3.55',
  t.near(unitCostFrom(53.28, 5, 3), 3.552, 1e-9), `${unitCostFrom(53.28, 5, 3)}`);
t.check('that is a $0.002/lb correction', t.near(drift(53.28, 5, 3), 0.002, 1e-9));

// A generated corpus wide enough to cover the realistic invoice space.
const corpus = [];
for (const cost of [0.8, 4.5, 12.5, 26.6, 53.28, 111.84, 204.1, 429.12, 1164.04]) {
  for (const pq of [1, 3, 4, 5, 12, 26, 400, 750, 1000, 1980, 25000]) {
    for (const qo of [1, 2, 4, 8, 24]) corpus.push([cost, pq, qo]);
  }
}
t.check(`no case in ${corpus.length} moves more than half a cent per unit`,
  corpus.every(([c, pq, qo]) => drift(c, pq, qo) <= 0.005 + 1e-9),
  `max ${Math.max(...corpus.map(([c, pq, qo]) => drift(c, pq, qo)))}`);
t.check('and every case lands exactly on line total / total units',
  corpus.every(([c, pq, qo]) => t.near(unitCostFrom(c, pq, qo), c / (pq * qo), 1e-12)));
t.check('the new value is never further from the truth than the old one',
  corpus.every(([c, pq, qo]) => {
    const truth = c / (pq * qo);
    return Math.abs(unitCostFrom(c, pq, qo) - truth) <= Math.abs(roundedToCents(c, pq, qo) - truth) + 1e-12;
  }));

t.section('degenerate packs behave exactly as before');
t.check('pack_qty 0 falls back to the line total', unitCostFrom(40, 0, 2) === 40);
t.check('qty_ordered 0 falls back to the line total', unitCostFrom(40, 5, 0) === 40);
t.check('negative pack falls back to the line total', unitCostFrom(40, -5, 1) === 40);
t.check('matches the old fallback in all three cases',
  [[40, 0, 2], [40, 5, 0], [40, -5, 1]]
    .every(([c, pq, qo]) => unitCostFrom(c, pq, qo) === roundedToCents(c, pq, qo)));

// ── 4. The three writers of this column now agree ────────────────
// entryPackFacts() prefers a stored cost_per_unit and otherwise computes the
// fallback itself. Before the fix those two answers disagreed for every per-ml
// row — the same purchase cost a different amount depending on whether the
// column happened to be populated.
t.section('stored value and computed fallback agree');
for (const [name, pq, pu, qo, cost] of LIVE) {
  const stored   = entryPackFacts({ pack_qty: pq, pack_unit: pu, qty_ordered: qo, cost,
                                    cost_per_unit: unitCostFrom(cost, pq, qo) }).cost_per_unit;
  const computed = entryPackFacts({ pack_qty: pq, pack_unit: pu, qty_ordered: qo, cost }).cost_per_unit;
  t.check(`${name}: stored === recomputed`, t.near(stored, computed, 1e-9),
    `stored ${stored} vs computed ${computed}`);
}
t.section('...which they did NOT before the fix');
const heinekenOldStored = entryPackFacts({
  pack_qty: 1980, pack_unit: 'ml', qty_ordered: 4, cost: 43.96, cost_per_unit: 0.01,
}).cost_per_unit;
const heinekenComputed = entryPackFacts({
  pack_qty: 1980, pack_unit: 'ml', qty_ordered: 4, cost: 43.96,
}).cost_per_unit;
t.check('Heineken stored $0.01 vs computed $0.00555 — a real disagreement',
  !t.near(heinekenOldStored, heinekenComputed, 1e-6),
  `${heinekenOldStored} vs ${heinekenComputed}`);

// products.js saveEntry() computes unitPrice = lineTotal / (pack_qty * qty_ordered)
// with no rounding. The import path must land on the same number.
t.section('manual entry and AI import land on the same number');
const manualEntry = (cost, pq, qo) => { const u = pq * qo; return u > 0 ? cost / u : cost; };
for (const [name, pq, , qo, cost] of LIVE) {
  t.check(`${name}: import === manual entry`,
    t.near(unitCostFrom(cost, pq, qo), manualEntry(cost, pq, qo), 1e-12));
}

// ── 5. The display layer shows real money ────────────────────────
// fmtUnitCost() quotes per-g prices per kg and per-ml per L precisely so these
// fractions read as money. Full precision is what makes that work.
t.section('the UI shows a sensible price, not $0.00 or $0.01');
t.check('Heineken reads "$5.55 / L"',
  fmtUnitCost(unitCostFrom(43.96, 1980, 4), 'ml') === '$5.55 / L',
  fmtUnitCost(unitCostFrom(43.96, 1980, 4), 'ml'));
t.check('Sparkling water reads "$14.93 / L"',
  fmtUnitCost(unitCostFrom(112.00, 750, 10), 'ml') === '$14.93 / L',
  fmtUnitCost(unitCostFrom(112.00, 750, 10), 'ml'));
t.check('flour reads "$1.50 / kg"',
  fmtUnitCost(unitCostFrom(1.50, 1000, 1), 'g') === '$1.50 / kg',
  fmtUnitCost(unitCostFrom(1.50, 1000, 1), 'g'));
t.check('the 4L Pinot box still reads "$7.38 / L"',
  fmtUnitCost(unitCostFrom(29.52, 4, 1), 'L') === '$7.38 / L',
  fmtUnitCost(unitCostFrom(29.52, 4, 1), 'L'));
t.check('under the old rounding Heineken read "$10.00 / L"',
  fmtUnitCost(roundedToCents(43.96, 1980, 4), 'ml') === '$10.00 / L',
  fmtUnitCost(roundedToCents(43.96, 1980, 4), 'ml'));

// ── 6. A recipe costs correctly ──────────────────────────────────
// The whole point: what a pour actually costs.
t.section('a real pour costs the right amount');
const glass150ml = unitCostFrom(429.12, 750, 24) * 150;   // 150 ml of the Verduzzo
t.check('a 150 ml glass of Pinot Grigio is $3.58', t.near(glass150ml, 3.576, 1e-3), `${glass150ml.toFixed(3)}`);
t.check('the old rounding priced that glass at $3.00',
  t.near(roundedToCents(429.12, 750, 24) * 150, 3.00, 1e-9));
const pint473 = unitCostFrom(43.96, 1980, 4) * 473;       // a 473 ml can of Heineken
t.check('a 473 ml Heineken costs $2.63', t.near(pint473, 2.6254, 1e-3), `${pint473.toFixed(4)}`);
t.check('the old rounding priced it at $4.73 — nearly double',
  t.near(roundedToCents(43.96, 1980, 4) * 473, 4.73, 1e-9));

t.done();
