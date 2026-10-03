// A recipe or finished product can't be SAVED while a line can't be costed.
//
// Two of the three ways a line ends up without a price block the save: a unit
// that can't be converted, and a missing weight that would bridge it. Both were
// previously saved as $0 (the recipe form warned, the finished-product form said
// nothing), leaving a dish on the books costing less than it does. The third — a
// product never purchased — is deliberately NOT blocked: a new customer builds
// recipes before every invoice is in.
//
// The unit itself is still allowed on screen with its ⚠ (see
// uncostable-not-mispriced.test.mjs for why refusing it there is worse). Only
// the Save is refused, and before anything is written.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const STATIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'static');
const body = (file, fn) => {
  const src = readFileSync(join(STATIC, file), 'utf8');
  const at = src.indexOf(`async function ${fn}(`);
  return src.slice(at, src.indexOf('\n}\n', at));
};
const t = suite('uncostable-blocks-save');

t.section('recipes: the save stops before anything is written');
const sr = body('recipes.js', 'saveRecipe');
const srBlock = sr.indexOf('const blocked = items.filter(r => isUncostable(calcIngredientLineCost(r)))');
t.check('saveRecipe looks for lines that can\'t be costed', srBlock > 0);
t.check('it refuses with an error and returns', /if \(blocked\.length\) \{[\s\S]*?'error'\);\s*return;\s*\}/.test(sr));
t.check('the refusal comes before the first write', srBlock < sr.search(/await api(Post|Put|Patch|Delete)\(/));
t.check('the old "saved as $0" warning is gone', !/Saving counts those lines as/.test(sr));
t.check('the message names the line and its fix', /uncostableReason\(first\.pack_unit, first\.unit \|\| 'kg', first\.product_name\)/.test(sr));

t.section('finished products: the same rule');
const sf = body('finished-products.js', 'saveFp');
const sfBlock = sf.indexOf('const blocked = fpUncostableLines(activeRecipes, activeProducts)');
t.check('saveFp looks for lines that can\'t be costed', sfBlock > 0);
t.check('it refuses with an error and returns', /if \(blocked\.length\) \{[\s\S]*?'error'\);\s*return;\s*\}/.test(sf));
t.check('the refusal comes before the first write', sfBlock < sf.search(/await api(Post|Put|Patch|Delete)\(/));

t.section('which finished-product lines are blocked');
const { fpUncostableLines } = loadBrowserModule(['utils.js', 'finished-products.js'], ['fpUncostableLines']);
const rice   = { ref_id: 'p1', ref_name: 'Arborio Rice', quantity: 1, unit: 'kg', unit_cost: 3.45, pack_unit: 'kg' };
const ragu   = (unit) => ({ ref_id: 'r1', ref_name: 'Bolognese Ragu', quantity: 70, unit, yield_unit: 'kg', cost_per_yield_unit: 5 });
const limes  = { ref_id: 'p2', ref_name: 'Limes', quantity: 100, unit: 'g', unit_cost: 0.5, pack_unit: 'each', avg_weight: null };
const napkin = { ref_id: 'p3', ref_name: 'Napkins', quantity: 200, unit: 'each', unit_cost: 30, pack_unit: 'case' };
const never  = { ref_id: 'p4', ref_name: 'Saffron', quantity: 1, unit: 'g', unit_cost: 0, pack_unit: 'g' };
const one = (r, p) => fpUncostableLines(r, p);
t.check('a clean product line is not blocked', one([], [rice]).length === 0);
t.check('a recipe in a unit that matches its yield is not blocked', one([ragu('g')], []).length === 0);
t.check('a recipe yielding kg used by L is blocked, and says so',
  one([ragu('L')], []).length === 1 && /Bolognese Ragu.*yields kg.*can't be converted to L/.test(one([ragu('L')], [])[0]));
t.check('an each-priced product used by weight with no weight is blocked, with the fix',
  one([], [limes]).length === 1 && /Limes.*Average Weight per Unit/.test(one([], [limes])[0]));
t.check('a case-priced product used by the each is blocked, with the fix',
  one([], [napkin]).length === 1 && /Napkins.*priced by the case.*sub-unit/.test(one([], [napkin])[0]));
t.check('a never-purchased product (price 0, units fine) is NOT blocked', one([], [never]).length === 0);
t.check('every blocked line is reported', one([ragu('L')], [rice, limes, napkin]).length === 3);

t.section('never purchased: allowed, but marked');
const { buildLiveCostIndex } = loadBrowserModule(['utils.js'], ['buildLiveCostIndex']);
const idx = buildLiveCostIndex({
  generics: [{ id: 'flour', name: 'Flour', base_unit: 'kg' }, { id: 'saffron', name: 'Saffron', base_unit: 'g' }],
  entries: [{ id: 'e1', generic_product_id: 'flour', purchase_date: '2026-09-01', pack_qty: 10, pack_unit: 'kg', qty_ordered: 1, cost: 20, cost_per_unit: 2 }],
  recipes: [{ id: 'clean', servings: 1, yield_unit: 'kg' }, { id: 'gap', servings: 1, yield_unit: 'kg' }],
  recipeItems: [
    { recipe_id: 'clean', product_id: 'flour', quantity: 1, unit: 'kg' },
    { recipe_id: 'gap', product_id: 'flour', quantity: 1, unit: 'kg' },
    { recipe_id: 'gap', product_id: 'saffron', quantity: 2, unit: 'g' },
  ],
  finishedProducts: [{ id: 'fpClean' }, { id: 'fpViaRecipe' }, { id: 'fpDirect' }],
  fpItems: [
    { finished_product_id: 'fpClean', item_type: 'recipe', ref_id: 'clean', quantity: 1, unit: 'kg' },
    { finished_product_id: 'fpViaRecipe', item_type: 'recipe', ref_id: 'gap', quantity: 1, unit: 'kg' },
    { finished_product_id: 'fpDirect', item_type: 'product', ref_id: 'saffron', quantity: 1, unit: 'g' },
  ],
  plan: 'essential',
});
t.check('a recipe with every ingredient purchased is not marked', idx.recipe.get('clean').unpriced === false);
t.check('a recipe with a never-purchased ingredient is marked', idx.recipe.get('gap').unpriced === true);
t.check('…and is NOT flagged as uncostable, which is what blocks saving', idx.recipe.get('gap').uncostable === false);
t.check('…and still totals what it can price', idx.recipe.get('gap').total_cost === 2);
t.check('a finished product inherits the mark from its recipe', idx.finished.get('fpViaRecipe').unpriced === true && idx.finished.get('fpViaRecipe').uncostable === false);
t.check('a finished product with a never-purchased product line is marked', idx.finished.get('fpDirect').unpriced === true);
t.check('a clean finished product is not marked', idx.finished.get('fpClean').unpriced === false);

t.done();
