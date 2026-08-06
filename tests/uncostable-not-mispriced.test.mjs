// A unit the app cannot price must make the line UNCOSTABLE — never a confident
// number computed in the wrong unit.
//
// The case this exists for: napkins bought as 1 case for $30. You put 200 in a
// recipe meaning 200 napkins and pick "each". `case` has no bridge to `each` —
// the app genuinely cannot know what is inside a case — so the switch used to be
// refused and the dropdown reverted to `case`. The quantity was left alone. The
// line then read "200 case" and billed $6,000: arithmetically perfect, and
// nothing like what anyone meant. The toast explaining the refusal was gone in
// three seconds; the $6,000 was what got saved.
//
// It is now allowed through and lands in the uncostable path that already
// existed for an each-priced product used by weight: ⚠ n/a on the line, ⚠ on the
// total, a warning before saving, and $0 contributed rather than $6,000.
//
// The rule this file defends, in one line: an unbridgeable unit yields NULL, and
// null is not a number. A regression here does not throw or look broken — it
// quietly produces a plausible figure, which is why it needs pinning.
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = suite('uncostable-not-mispriced');

const r = loadBrowserModule(
  ['utils.js', 'recipes.js'],
  ['calcIngredientLineCost', 'isUncostable', 'sumLineCosts', 'anyUncostable',
   'unitConversionFactor', 'uncostableReason'],
);

// ── The $6,000 napkin line ───────────────────────────────────────
t.section('a case-priced product used by the each');

const napkins = { product_id: 'p-napkins', quantity: 200, unit: 'each', unit_cost: 30, pack_unit: 'case' };
const cost = r.calcIngredientLineCost(napkins);

t.check('the line is uncostable, not priced', r.isUncostable(cost), `got ${cost}`);
t.check('and specifically NOT the $6,000 it used to bill', cost !== 6000, `got ${cost}`);
t.check('it is null, not 0 — a silent zero reads as a free ingredient',
  cost === null, `got ${JSON.stringify(cost)}`);

t.section('it propagates to the recipe, not just the row');
const rows = [
  { product_id: 'p-flour', quantity: 2, unit: 'kg', unit_cost: 10, pack_unit: 'kg' },  // $20
  napkins,                                                        // uncostable
];
t.check('the total excludes it rather than adding $6,000',
  r.sumLineCosts(rows) === 20, `got ${r.sumLineCosts(rows)}`);
t.check('and the recipe is flagged so the save warning fires',
  r.anyUncostable(rows) === true);

// ── The other two reasons a line cannot be costed ────────────────
t.section('the same treatment for the other unbridgeable pairs');
for (const [pack, want, why] of [
  ['each', 'g',   'each → weight with no average weight set'],
  ['kg',   'ml',  'weight → volume'],
  ['L',    'kg',  'volume → weight'],
  ['ct',   'each','an unrecognised pack unit'],
]) {
  const c = r.calcIngredientLineCost({ product_id: 'p1', quantity: 200, unit: want, unit_cost: 30, pack_unit: pack });
  t.check(`${pack} → ${want} is uncostable (${why})`, r.isUncostable(c), `got ${c}`);
}

// ── What must still cost normally ────────────────────────────────
// The fix must not turn working conversions into ⚠ — that would be a worse bug
// than the one it replaces, and a silent one, since $0 looks like a cheap recipe.
t.section('everything that could be costed before still is');
const same = [
  [{ product_id: 'p1', quantity: 500, unit: 'g',  unit_cost: 10,  pack_unit: 'kg'   }, 5,     'kg priced, used in g'],
  [{ product_id: 'p1', quantity: 180, unit: 'ml', unit_cost: 4.99, pack_unit: 'gal' }, 0.2373,'gal priced, used in ml'],
  [{ product_id: 'p1', quantity: 2,   unit: 'case', unit_cost: 30, pack_unit: 'case'}, 60,    'case priced, used by the case'],
  [{ product_id: 'p1', quantity: 3,   unit: 'each', unit_cost: 0.3, pack_unit: 'each'}, 0.9,  'each priced, used by the each'],
];
for (const [row, want, why] of same) {
  const c = r.calcIngredientLineCost(row);
  t.check(`${why} = ${want}`, typeof c === 'number' && Math.abs(c - want) < 0.001, `got ${c}`);
}

// The sub-unit path is the real remedy for a case-priced item and must be
// untouched — this is how a case of 24 tonics already costs $0.90 a bottle.
t.section('the sub-unit path — the actual fix — still works');
const tonic = { product_id: 'p-tonic', quantity: 2, unit: 'bottle', unit_cost: 21.60, pack_unit: 'case',
                sub_unit_name: 'bottle', sub_unit_qty: 24 };
const tc = r.calcIngredientLineCost(tonic);
t.check('a case with a sub-unit costs per sub-unit, not ⚠',
  typeof tc === 'number' && tc > 0, `got ${tc}`);

// ── The message has to name the remedy ───────────────────────────
t.section('the explanation tells the user what to do');
const caseMsg = r.uncostableReason('case', 'each', 'Paper Napkins');
t.check('a case-priced item is pointed at the sub-unit', /sub-unit/i.test(caseMsg), caseMsg);
t.check('and it names the product', /Paper Napkins/.test(caseMsg), caseMsg);
const weightMsg = r.uncostableReason('each', 'g', 'Vanilla Pods');
t.check('an each↔weight item is pointed at the average weight',
  /average weight/i.test(weightMsg), weightMsg);
t.check('and is NOT told to set a sub-unit, which would not help',
  !/sub-unit/i.test(weightMsg), weightMsg);
const hardMsg = r.uncostableReason('kg', 'ml', 'Flour');
t.check('weight↔volume is told there is no conversion, with no false remedy',
  !/sub-unit|average weight/i.test(hardMsg), hardMsg);

// ── The behaviour itself, driven through onUnitChange ────────────
// This is the discriminating test: calcIngredientLineCost was ALWAYS correct for
// case→each — the bug was that the UI never let `unit` reach 'each' in the first
// place. So the assertions above pin the invariant; this one catches the bug.
t.section('choosing an impossible unit now sticks, instead of snapping back');

// Enough DOM for onUnitChange and the real showToast in utils.js (which
// shadows any shim, so the message is captured off the '#toast' element it
// actually writes to, rather than by stubbing the function).
const toasts = [];
const stubs = new Map();
const mkEl = (id) => ({
  id, value: '', textContent: '', innerHTML: '', className: '', dataset: {},
  style: {}, classList: { add() {}, remove() {} },
  appendChild(child) { if (id === 'toast' && child && child._text) toasts.push(child._text.trim()); },
});
const el = (id) => {
  if (!stubs.has(id)) stubs.set(id, mkEl(id));
  return stubs.get(id);
};
const ui = loadBrowserModule(
  ['utils.js', 'recipes.js'],
  ['onUnitChange', 'ingredientRows'],
  {
    document: {
      addEventListener() {}, getElementById: el,
      querySelector: () => null, querySelectorAll: () => [], body: {},
      createElement: () => mkEl('created'),
      createTextNode: (txt) => ({ _text: String(txt) }),
    },
    setTimeout: () => 0, clearTimeout: () => {},
  },
);

ui.ingredientRows.length = 0;
ui.ingredientRows.push({
  product_id: 'p-napkins', product_name: 'Paper Napkins',
  quantity: 200, unit: 'case', unit_cost: 30, pack_unit: 'case',
});
const sel = el('ing-unit-0');
sel.dataset.prevUnit = 'case';
sel.value = 'each';           // the user picks "each" from the dropdown
ui.onUnitChange(0);

t.check('the row keeps the unit the user chose', ui.ingredientRows[0].unit === 'each',
  `got ${ui.ingredientRows[0].unit}`);
t.check('the dropdown is NOT snapped back to case', sel.value === 'each', `got ${sel.value}`);
t.check('and the user is told why it will not cost', toasts.length === 1, JSON.stringify(toasts));
t.check('the explanation names the sub-unit remedy', /sub-unit/i.test(toasts[0] || ''), toasts[0]);

// The line that results is the whole point: unpriced, not $6,000.
t.check('the resulting line is uncostable, not $6,000',
  r.isUncostable(r.calcIngredientLineCost(ui.ingredientRows[0])),
  `got ${r.calcIngredientLineCost(ui.ingredientRows[0])}`);

// A switch that CAN be costed must still go through silently.
toasts.length = 0;
ui.ingredientRows[0] = { product_id: 'p-flour', quantity: 2, unit: 'kg', unit_cost: 10, pack_unit: 'kg' };
const sel2 = el('ing-unit-0');
sel2.dataset.prevUnit = 'kg';
sel2.value = 'g';
ui.onUnitChange(0);
t.check('a valid switch still applies', ui.ingredientRows[0].unit === 'g');
t.check('and says nothing', toasts.length === 0, JSON.stringify(toasts));

// ── The revert must not come back ────────────────────────────────
// This is the whole bug: the dropdown was put back and the quantity was not.
t.section('a refused unit no longer reverts the dropdown');
for (const f of ['recipes.js', 'finished-products.js']) {
  const src = readFileSync(join(ROOT, 'public', 'static', f), 'utf8');
  t.check(`${f} no longer says "unit reset"`, !/unit reset/.test(src));
  t.check(`${f} no longer reverts a select to prevUnit on an incompatible switch`,
    !/sel\.value = prevUnit;\s*\n\s*showToast/.test(src) &&
    !/if \(sel\) sel\.value = prevUnit;\s*\n\s*showToast/.test(src));
}

t.done();
