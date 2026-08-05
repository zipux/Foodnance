// The finished-product EDIT FORM must cost recipes from the live index, not
// from recipes.total_cost — onFpRecipeChange in public/static/finished-products.js.
//
// Bug 3 from the 2026-08-05 pizzeria test. recipes.total_cost freezes at the
// recipe's last Save. After a flour price rise the saved list card said
// Pizza Margherita cost $1.92 while opening the same product for editing said
// $1.84 — one screen contradicting itself by the amount of the rise. And Save
// wrote the stale figure back into the product.
//
// The numbers below are the real ones from that session:
//   Pizza Dough  stored total_cost 2.4060 (flour at $1.30/kg)
//                live  total_cost 3.2120 (flour at $1.82/kg)
//                yield 2500 g
//   Margherita uses 250 g of it -> $0.2406 stale vs $0.3212 live.
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const t = suite('fp-form-live-cost');

const STORED_TOTAL = 2.4060;
const LIVE_TOTAL   = 3.2120;
const YIELD        = 2500;

function makeDom() {
  const els = new Map();
  const make = (id) => ({
    id, value: '', textContent: '', innerHTML: '',
    style: {}, dataset: {}, options: [],
    classList: { add() {}, remove() {}, contains: () => false },
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, dispatchEvent() {}, appendChild() {}, closest: () => null,
  });
  return {
    getElementById: (id) => { if (!els.has(id)) els.set(id, make(id)); return els.get(id); },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    body: { appendChild() {}, removeChild() {} }, createElement: () => make('x'),
    _els: els,
  };
}

// Drive onFpRecipeChange for one row and report the per-yield-unit cost it
// settled on. `indexed` decides whether the live index knows this recipe.
function run({ indexed }) {
  const document = makeDom();
  const { onFpRecipeChange, _seed, _read } = loadBrowserModule(
    ['utils.js', 'finished-products.js'],
    ['onFpRecipeChange',
     `_seed: (recipes, index) => {
        allRecipes_fp = recipes;
        fpCostIndex = index;
        fpRecipeRows = [{ ref_id: 'r1', quantity: 250, unit: 'g', _manualUnit: false }];
      }`,
     '_read: () => fpRecipeRows[0]'],
    {
      document,
      window: { addEventListener() {}, __accountType: 'restaurant', __accountPlan: 'essential' },
    },
  );

  const recipes = [{ id: 'r1', name: 'Pizza Dough', total_cost: STORED_TOTAL,
                     servings: YIELD, yield_unit: 'g' }];
  const index = { product: new Map(), recipe: new Map(), finished: new Map() };
  if (indexed) {
    index.recipe.set('r1', {
      total_cost: LIVE_TOTAL,
      cost_per_yield_unit: LIVE_TOTAL / YIELD,
      yield_unit: 'g', servings: YIELD, uncostable: false,
    });
  }

  document.getElementById('fpr-sel-0').value = 'r1';
  _seed(recipes, index);
  onFpRecipeChange(0);

  const row = _read();
  return {
    perYieldUnit: row.cost_per_yield_unit,
    lineCost: row.cost_per_yield_unit * 250,   // Margherita uses 250 g
    yieldUnit: row.yield_unit,
  };
}

t.section('the form reads the live index, like the list does');
const live = run({ indexed: true });
t.check('250 g of dough costs $0.3212, not the stale $0.2406',
  Math.abs(live.lineCost - 0.3212) < 0.0001, `got ${live.lineCost}`);
t.check('per-yield-unit comes from the live total',
  Math.abs(live.perYieldUnit - LIVE_TOTAL / YIELD) < 1e-9, String(live.perYieldUnit));
// The exact contradiction that was on screen.
t.check('form no longer disagrees with the card by the price rise',
  Math.abs(live.lineCost - 0.2406) > 0.0001);
t.check('yield unit carried through', live.yieldUnit === 'g');

t.section('stored column is a fallback only — for a recipe not indexed yet');
// The index is rebuilt on dm:plan-known, which can land after the form is drawn.
// Falling back beats showing $0.00, but it must ONLY happen when there is no
// live figure to be had.
const fallback = run({ indexed: false });
t.check('falls back to the stored total rather than zero',
  Math.abs(fallback.perYieldUnit - STORED_TOTAL / YIELD) < 1e-9,
  String(fallback.perYieldUnit));
t.check('and that fallback is NOT what the indexed case returns',
  Math.abs(fallback.perYieldUnit - live.perYieldUnit) > 1e-9);

t.done();
