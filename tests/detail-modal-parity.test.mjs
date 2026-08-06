// The detail modal must show the same numbers, and the same warnings, as the
// card you clicked to open it.
//
// Three screens show every recipe and menu item: the list card, the detail
// modal, and the edit form. Two rounds of fixes landed on the card and the form
// and missed the modal, so one click apart you got:
//
//   Cocoa Base   card $4.83 / kg    form Cost per kg $4.83    modal $0.00 / g
//   Vanilla Cream card $1.74 ⚠      form $1.74 ⚠              modal $1.74
//
// The second line is the dangerous one: the modal is the screen people open to
// check a cost in detail, and it was the only one not saying that an ingredient
// could not be priced at all. A total that quietly drops an ingredient reads
// exactly like a complete one.
//
// These are static audits of the shipped source, in the same spirit as
// voided-entries.test.mjs: the render functions build HTML strings out of live
// module state, so what is worth pinning is that they reach for the shared
// helpers rather than doing the arithmetic again by hand.
import { suite } from './helpers/assert.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = f => readFileSync(join(ROOT, 'public', 'static', f), 'utf8');
const t    = suite('detail-modal-parity');

// Pull one function's body out of a file, so a match somewhere else in the file
// cannot make these pass by accident.
function fnBody(source, startMarker) {
  const i = source.indexOf(startMarker);
  if (i < 0) return '';
  let depth = 0, started = false;
  for (let j = i; j < source.length; j++) {
    if (source[j] === '{') { depth++; started = true; }
    else if (source[j] === '}') { depth--; if (started && depth === 0) return source.slice(i, j + 1); }
  }
  return source.slice(i);
}

const recipes  = src('recipes.js');
const fpjs     = src('finished-products.js');
const detail   = fnBody(recipes, 'async function openRecipeDetail');
const fpDetail = fnBody(fpjs,    'async function openFpDetail');
const fpRecalc = fnBody(fpjs,    'function recalcFpCosts');

t.check('found openRecipeDetail', detail.length > 200);
t.check('found openFpDetail',     fpDetail.length > 200);
t.check('found recalcFpCosts',    fpRecalc.length > 200);

// ── Small prices are quoted in a bigger unit, like the other two screens ──
t.section('the modal no longer prints "$0.00 / g"');

t.check('the per-yield figure is scaled, not divided raw',
  /scalePriceUnit\(\s*totalCost\s*\/\s*yieldQty/.test(detail), 'expected scalePriceUnit(totalCost / yieldQty, …)');
t.check('the raw division is gone',
  !/\$\{fmt\(totalCost\s*\/\s*yieldQty\)\}/.test(detail));
t.check('the label is scaled to match the figure above it',
  /priceUnitLabel\(yieldUnit\)/.test(detail),
  'a "Cost per g" label over a per-kg number is worse than either alone');
t.check('the label no longer prints the raw yield unit',
  !/Cost per \$\{esc\(yieldUnit\)\}/.test(detail));

// ── The ⚠ reaches the modal ──────────────────────────────────────
t.section('the "could not be costed" marker is not dropped');

t.check('the recipe modal computes an uncostable flag', /uncWarn/.test(detail));
t.check('and puts it on the total', /\$\{fmt\(totalCost\)\}\$\{uncWarn\}/.test(detail));
t.check('the recipe modal takes its flag from the shared index',
  /rCostIndex\.recipe\.get\(recipe\.id\)/.test(detail),
  'the card reads the index; recomputing here is how the two drifted apart');

t.check('the finished-product modal computes one too', /uncWarn/.test(fpDetail));
t.check('it uses the same shared source as the card', /fpLiveUncostable\(fp\)/.test(fpDetail));
// It appears twice on that screen — the info grid at the top and the cost box.
t.check('and it appears on both totals',
  (fpDetail.match(/\$\{fmt\(totalCost\)\}\$\{uncWarn\}/g) || []).length === 2,
  `found ${(fpDetail.match(/\$\{fmt\(totalCost\)\}\$\{uncWarn\}/g) || []).length}`);

// All three screens must use the identical marker, or they read as three
// different conditions rather than one.
t.section('one marker, not three');
const MARKER = 'An ingredient could not be costed';
for (const [name, source] of [['recipes.js', recipes], ['finished-products.js', fpjs]]) {
  const n = (source.match(new RegExp(MARKER, 'g')) || []).length;
  t.check(`${name} uses the shared wording in every place it warns`, n >= 2, `found ${n}`);
}

// ── A menu item inherits its recipe's uncostable-ness ────────────
// The recipe hands back a good number with the unpriceable ingredient left out,
// so a form that only inspects its own lines reports a clean total.
t.section('the finished-product form inherits the flag from its recipes');

t.check('the form consults the recipe index, not just its own lines',
  /fpCostIndex\.recipe\.get\([^)]*\)\?\.uncostable/.test(fpRecalc),
  'expected the recipe rows loop to check the shared index');
t.check('it still flags its own unconvertible lines',
  /factor === null.*anyUncostable = true/s.test(fpRecalc));
t.check('and still flags an uncostable product line',
  /c === null.*anyUncostable = true/s.test(fpRecalc));

// The index is what carries the flag up a level, so pin that it does.
t.section('the shared index propagates the flag upwards');
const utils = src('utils.js');
t.check('a finished product inherits uncostable from a recipe it contains',
  /if \(src && src\.uncostable\) uncostable = true/.test(utils),
  'buildLiveCostIndex must carry recipe → finished, or nothing above knows');

t.done();
