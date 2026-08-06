// The recipe and finished-product screens must use ONE conversion table — the
// shared one in utils.js — not private copies of it.
//
// The private copies are what made a 180 ml pour of milk bought by the gallon
// cost $898.20. `gal` was known to utils.js and to the backend, but not to
// recipes.js, so the screen refused a conversion it could genuinely perform and
// left the 180 sitting under `gal`, where it was charged at the gallon price.
// `case` behaved the same way and `case` ships in the default unit picker.
//
// The weight of this file is deliberately on what must still be REFUSED. The
// whole design rests on an unbridgeable pair being uncostable rather than
// silently multiplied by 1, so a change that makes everything convert would be
// worse than the bug it replaced.
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = suite('unit-conversion-tables');

const recipes = loadBrowserModule(
  ['utils.js', 'recipes.js'],
  ['unitConversionFactor', '_unitsCompatible', 'buildUnitOptions'],
);
const fp = loadBrowserModule(
  ['utils.js', 'finished-products.js'],
  ['fp_conversionFactor', '_fpUnitsCompatible', '_fpUnitDim', 'buildFpUnitOptions'],
);

// ── The bug: gallons ─────────────────────────────────────────────
t.section('a gallon converts, on both screens');

const galToMl = recipes.unitConversionFactor('gal', 'ml');
t.check('recipes: gal → ml is possible at all', galToMl !== null, `got ${galToMl}`);
t.check('recipes: the switch is allowed', recipes._unitsCompatible('gal', 'ml') === true);
t.check('fp: gal → ml is possible at all', fp.fp_conversionFactor('gal', 'ml') !== null);

// $9.98 for 2 gal = $4.99/gal. 180 ml of that is 23.7 cents, not $898.20.
const milkPerGal = 4.99;
const latteMilk  = milkPerGal * 180 * galToMl;
t.check('180 ml of $4.99/gal milk costs about 24 cents',
  Math.abs(latteMilk - 0.2373) < 0.001, `got ${latteMilk}`);
t.check('and emphatically not the old $898.20',
  latteMilk < 1, `got ${latteMilk}`);

// The other half of the report: 600 ml in an iced coffee base.
const iced = milkPerGal * 600 * galToMl;
t.check('600 ml comes to about 79 cents, not $2,995.68',
  Math.abs(iced - 0.7910) < 0.001, `got ${iced}`);

// ── What must still be refused ───────────────────────────────────
t.section('unbridgeable pairs are still uncostable, never charged at 1x');

const refuse = [
  ['case', 'each',  'a case is not a countable each'],
  ['case', 'kg',    'a case has no weight the app knows'],
  ['ct',   'each',  'an unrecognised pack unit'],
  ['kg',   'ml',    'weight never crosses to volume'],
  ['L',    'kg',    'volume never crosses to weight'],
  ['gal',  'kg',    'gallons are volume, not weight'],
  ['each', 'ml',    'each never crosses to volume'],
];
for (const [from, to, why] of refuse) {
  t.check(`recipes: ${from} → ${to} is null (${why})`,
    recipes.unitConversionFactor(from, to) === null,
    `got ${recipes.unitConversionFactor(from, to)}`);
  t.check(`recipes: ${from} → ${to} is blocked in the picker`,
    recipes._unitsCompatible(from, to) === false);
  t.check(`fp: ${from} → ${to} is null`,
    fp.fp_conversionFactor(from, to) === null,
    `got ${fp.fp_conversionFactor(from, to)}`);
}

// A refusal must be null — the value the callers flag as "⚠ n/a". Zero would
// read as a free ingredient and understate every margin above it.
t.check('a refusal is null, not 0', recipes.unitConversionFactor('kg', 'ml') !== 0);
t.check('a refusal is null, not 1', recipes.unitConversionFactor('kg', 'ml') !== 1);

// ── Each ↔ weight still needs an average weight ──────────────────
t.section('the each ↔ weight bridge is unchanged');

t.check('each → g with no average weight is uncostable',
  recipes.unitConversionFactor('each', 'g', 0) === null);
t.check('each → g with an average weight works',
  Math.abs(recipes.unitConversionFactor('each', 'g', 0.05) - 0.02) < 1e-9,
  `got ${recipes.unitConversionFactor('each', 'g', 0.05)}`);
// Missing weight is a gap the user can fill, so the picker must still OFFER it —
// blocking here would leave them nowhere to go.
t.check('but the picker still offers it, so the user can go and set the weight',
  recipes._unitsCompatible('each', 'g') === true);

// Finished products keep their extra rule: a RECIPE line has no average weight,
// so each↔weight is refused there even though a product line allows it.
t.check('fp product line may bridge each ↔ weight',
  fp._fpUnitsCompatible('each', 'g', true) === true);
t.check('fp recipe line may NOT bridge each ↔ weight',
  fp._fpUnitsCompatible('each', 'g', false) === false);

// ── The arithmetic that already worked must not move ─────────────
t.section('every conversion that already worked returns the same number');

const unchanged = [
  ['kg', 'g',     0.001],
  ['g',  'kg',    1000],
  ['kg', 'kg',    1],
  ['l',  'ml',    0.001],
  ['ml', 'l',     1000],
  ['L',  'ml',    0.001],
  ['oz', 'g',     0.001 / 0.0283495231],
];
for (const [from, to, want] of unchanged) {
  const got = recipes.unitConversionFactor(from, to);
  t.check(`${from} → ${to} = ${want}`, Math.abs(got - want) < 1e-9, `got ${got}`);
  const gotFp = fp.fp_conversionFactor(from, to);
  t.check(`fp: ${from} → ${to} = ${want}`, Math.abs(gotFp - want) < 1e-9, `got ${gotFp}`);
}

// The old private tables carried lb = 0.453592; the shared one carries the full
// 0.45359237. Pin the shared value so the copies can't creep back.
const lbToKg = recipes.unitConversionFactor('lb', 'kg');
t.check('lb → kg uses the full-precision factor',
  Math.abs(lbToKg - (1 / 0.45359237)) < 1e-9, `got ${lbToKg}`);

// A real line from the passing test report — 400 g of guanciale bought at
// $9.60 for 16 oz. It must still come to $8.4658.
const guanciale = (9.60 / 16) * 400 * recipes.unitConversionFactor('oz', 'g');
t.check('400 g of $0.60/oz guanciale is still $8.4658',
  Math.abs(guanciale - 8.4658) < 0.001, `got ${guanciale}`);

// ── The dropdown must never name a unit other than the costed one ─
t.section('the unit picker always shows the unit the line is costed in');

// No master list loaded → the fallback list, which has never contained 'gal'.
const opts = recipes.buildUnitOptions('gal', null);
t.check('a gal line renders a gal option', /value="gal"/.test(opts), opts);
t.check('and that option is the selected one',
  /<option value="gal"[^>]*selected/.test(opts), opts);
t.check('the first option is not silently selected instead',
  !/<option value="kg"[^>]*selected/.test(opts), opts);

const optsFp = fp.buildFpUnitOptions('gal', null);
t.check('fp: same', /<option value="gal"[^>]*selected/.test(optsFp), optsFp);

// A unit already in the list must not be duplicated.
const kgOpts = recipes.buildUnitOptions('kg', null);
t.check('a normal unit appears exactly once',
  (kgOpts.match(/value="kg"/g) || []).length === 1, kgOpts);
t.check('and is selected', /<option value="kg"[^>]*selected/.test(kgOpts), kgOpts);

// An empty unit must not inject a blank option.
t.check('no unit selected injects nothing',
  !/<option value=""/.test(recipes.buildUnitOptions('', null)));

// ── Produce Batch scaling ────────────────────────────────────────
// Found while fixing the above: the scale factor multiplied by a factor that
// converts the other way, so making 2 kg of a 500 g recipe scaled by 0.000004.
t.section('Produce Batch scales by the batch size, not its reciprocal');

const { invConvertQty } = loadBrowserModule(['utils.js'], ['invConvertQty']);
const scale = (qty, unit, yieldQty, yieldUnit) => {
  const c = invConvertQty(qty, unit, yieldUnit);
  return (c.error ? qty : c.qty) / yieldQty;
};
t.check('2 kg of a recipe yielding 500 g is 4 batches',
  Math.abs(scale(2, 'kg', 500, 'g') - 4) < 1e-9, `got ${scale(2, 'kg', 500, 'g')}`);
t.check('1 L of a recipe yielding 250 ml is 4 batches',
  Math.abs(scale(1, 'l', 250, 'ml') - 4) < 1e-9, `got ${scale(1, 'l', 250, 'ml')}`);
t.check('matching units are unaffected — 5 kg of a 1 kg recipe is 5',
  Math.abs(scale(5, 'kg', 1, 'kg') - 5) < 1e-9);
t.check('an unbridgeable pair falls back to the raw quantity, as before',
  Math.abs(scale(3, 'case', 1, 'kg') - 3) < 1e-9);

// ── The private tables must not come back ────────────────────────
t.section('neither page keeps its own conversion table');

for (const f of ['recipes.js', 'finished-products.js']) {
  const src = readFileSync(join(ROOT, 'public', 'static', f), 'utf8');
  t.check(`${f} declares no private weight table`,
    !/const\s+_\w*WEIGHT_KG\s*=\s*\{/.test(src));
  t.check(`${f} declares no private volume table`,
    !/const\s+_\w*VOLUME_ML\s*=\s*\{/.test(src));
  t.check(`${f} routes conversion through the shared helper`,
    /invConvertUnitCost\(/.test(src));
}

t.done();
