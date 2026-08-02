// Live costing — public/static/utils.js
//
// The behaviour being pinned, in the owner's words: "Margherita costs me $3.
// Flour goes up. Once all my old flour has been used, the finished product's
// cost increases on its own, without staff touching a recipe."
//
// So cost is DERIVED from current invoice prices every time it's read, never
// taken from the stored recipes.total_cost / finished_products.total_cost
// snapshots. These tests deliberately set those stored fields to nonsense, to
// prove nothing reads them.
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const { buildLiveCostIndex } = loadBrowserModule(['utils.js'], ['buildLiveCostIndex']);

const t = suite('live-costing');

// ── A tiny pizzeria ─────────────────────────────────────────────
// Flour bought twice: 5 kg at $4.50 ($0.90/kg), then 5 kg at $9.00 ($1.80/kg).
const generics = [
  { id: 'flour', name: 'Flour', base_unit: 'kg' },
  { id: 'yeast', name: 'Yeast', base_unit: 'kg' },
];
const entries = [
  { generic_product_id: 'flour', purchase_date: '2026-06-01', pack_qty: 5, pack_unit: 'kg', qty_ordered: 1, cost: 4.5,  cost_per_unit: 0.9 },
  { generic_product_id: 'flour', purchase_date: '2026-07-01', pack_qty: 5, pack_unit: 'kg', qty_ordered: 1, cost: 9.0,  cost_per_unit: 1.8 },
  { generic_product_id: 'yeast', purchase_date: '2026-06-01', pack_qty: 1, pack_unit: 'kg', qty_ordered: 1, cost: 10,   cost_per_unit: 10 },
];
// Dough yields 1 kg from 1 kg flour + 0.01 kg yeast. Stored cost is a lie.
const recipes     = [{ id: 'dough', name: 'Dough', servings: 1, yield_unit: 'kg', total_cost: 999 }];
const recipeItems = [
  { recipe_id: 'dough', product_id: 'flour', quantity: 1,    unit: 'kg' },
  { recipe_id: 'dough', product_id: 'yeast', quantity: 0.01, unit: 'kg' },
];
// Margherita uses 1 kg of dough. Stored cost is also a lie.
const finishedProducts = [{ id: 'marg', name: 'Margherita', selling_price: 12, total_cost: 999 }];
const fpItems = [{ finished_product_id: 'marg', item_type: 'recipe', ref_id: 'dough', ref_name: 'Dough', quantity: 1, unit: 'kg' }];

const index = (flourOnHand) => buildLiveCostIndex({
  generics, entries, recipes, recipeItems, finishedProducts, fpItems,
  inventory: [{ item_id: 'flour', item_type: 'raw_material', quantity: flourOnHand, unit: 'kg' }],
});

t.section('the old flour is still being eaten — old price applies');
// 10 kg bought, 6 kg left => 4 kg consumed, still inside the first 5 kg layer.
const before = index(6);
t.check('flour is $0.90/kg', t.near(before.product.get('flour').cost_per_unit, 0.9),
  `${before.product.get('flour').cost_per_unit}`);
t.check('dough costs $0.90 + $0.10 = $1.00', t.near(before.recipe.get('dough').total_cost, 1.0),
  `${before.recipe.get('dough').total_cost}`);
t.check('Margherita costs $1.00', t.near(before.finished.get('marg').total_cost, 1.0),
  `${before.finished.get('marg').total_cost}`);

t.section('old flour runs out — the price rolls over on its own');
// 3 kg left => 7 kg consumed, past the first layer, into the $1.80 one.
const after = index(3);
t.check('flour is now $1.80/kg', t.near(after.product.get('flour').cost_per_unit, 1.8),
  `${after.product.get('flour').cost_per_unit}`);
t.check('dough follows to $1.90', t.near(after.recipe.get('dough').total_cost, 1.9),
  `${after.recipe.get('dough').total_cost}`);
t.check('Margherita follows to $1.90', t.near(after.finished.get('marg').total_cost, 1.9),
  `${after.finished.get('marg').total_cost}`);
t.check('and nothing was re-saved to make that happen',
  recipes[0].total_cost === 999 && finishedProducts[0].total_cost === 999);

t.section('the stored snapshots are never read');
t.check('stored 999 is ignored for the recipe', !t.near(after.recipe.get('dough').total_cost, 999));
t.check('stored 999 is ignored for the product', !t.near(after.finished.get('marg').total_cost, 999));

t.section('margin follows the cost without anyone re-pricing');
const m = after.finished.get('marg');
t.check('selling price carried through', t.near(m.selling_price, 12), `${m.selling_price}`);
t.check('profit is 12 - 1.90', t.near(m.profit, 10.1), `${m.profit}`);
t.check('margin is 84.2%', t.near(m.margin_pct, 84.1666, 0.01), `${m.margin_pct}`);
t.check('margin fell as cost rose',
  after.finished.get('marg').margin_pct < before.finished.get('marg').margin_pct);

t.section('unit conversion inside a line');
// 250 g of flour at $1.80/kg = $0.45.
const grams = buildLiveCostIndex({
  generics, entries, inventory: [{ item_id: 'flour', item_type: 'raw_material', quantity: 3, unit: 'kg' }],
  recipes: [{ id: 'r', servings: 1, yield_unit: 'kg' }],
  recipeItems: [{ recipe_id: 'r', product_id: 'flour', quantity: 250, unit: 'g' }],
});
t.check('250 g at $1.80/kg = $0.45', t.near(grams.recipe.get('r').total_cost, 0.45),
  `${grams.recipe.get('r').total_cost}`);

t.section('a case priced per pack, used by the piece');
// 24 cans for $20.40 -> $0.85 a can, via the sub-unit path.
const cola = buildLiveCostIndex({
  generics: [{ id: 'cola', name: 'Cola', base_unit: 'each', sub_unit_name: 'can', sub_unit_qty: 24 }],
  entries:  [{ generic_product_id: 'cola', purchase_date: '2026-07-01', pack_qty: 1, pack_unit: 'case', qty_ordered: 1, cost: 20.4, cost_per_unit: 20.4 }],
  inventory: [{ item_id: 'cola', item_type: 'raw_material', quantity: 1, unit: 'case' }],
  finishedProducts: [{ id: 'meal', selling_price: 10 }],
  fpItems: [{ finished_product_id: 'meal', item_type: 'product', ref_id: 'cola', quantity: 1, unit: 'can' }],
});
t.check('one can costs $0.85', t.near(cola.finished.get('meal').total_cost, 0.85),
  `${cola.finished.get('meal').total_cost}`);
t.check('and it is not flagged uncostable', cola.finished.get('meal').uncostable === false);

t.section('an unbridgeable unit is flagged, never silently zero');
const bad = buildLiveCostIndex({
  generics: [{ id: 'cola', name: 'Cola', base_unit: 'each' }],
  entries:  [{ generic_product_id: 'cola', purchase_date: '2026-07-01', pack_qty: 24, pack_unit: 'each', qty_ordered: 1, cost: 20.4, cost_per_unit: 0.85 }],
  inventory: [{ item_id: 'cola', item_type: 'raw_material', quantity: 24, unit: 'each' }],
  finishedProducts: [{ id: 'meal', selling_price: 10 }],
  fpItems: [{ finished_product_id: 'meal', item_type: 'product', ref_id: 'cola', quantity: 500, unit: 'ml' }],
});
t.check('each -> ml is refused', bad.finished.get('meal').uncostable === true);
t.check('the bad line contributes 0, not a wrong number',
  t.near(bad.finished.get('meal').total_cost, 0), `${bad.finished.get('meal').total_cost}`);

t.section('an uncostable recipe taints the products above it');
const taint = buildLiveCostIndex({
  generics: [{ id: 'p', name: 'P', base_unit: 'each' }],
  entries:  [{ generic_product_id: 'p', purchase_date: '2026-07-01', pack_qty: 10, pack_unit: 'each', qty_ordered: 1, cost: 10, cost_per_unit: 1 }],
  inventory: [{ item_id: 'p', item_type: 'raw_material', quantity: 10, unit: 'each' }],
  recipes: [{ id: 'r', servings: 1, yield_unit: 'kg' }],
  recipeItems: [{ recipe_id: 'r', product_id: 'p', quantity: 1, unit: 'ml' }],   // each -> ml, impossible
  finishedProducts: [{ id: 'f', selling_price: 5 }],
  fpItems: [{ finished_product_id: 'f', item_type: 'recipe', ref_id: 'r', quantity: 1, unit: 'kg' }],
});
t.check('the recipe is flagged', taint.recipe.get('r').uncostable === true);
t.check('and the finished product inherits the flag', taint.finished.get('f').uncostable === true);

t.section('degenerate input');
const empty = buildLiveCostIndex();
t.check('no arguments is survivable', empty.product.size === 0 && empty.finished.size === 0);

const unpriced = buildLiveCostIndex({
  generics: [{ id: 'x', name: 'X', base_unit: 'kg' }],
  recipes: [{ id: 'r', servings: 1, yield_unit: 'kg' }],
  recipeItems: [{ recipe_id: 'r', product_id: 'x', quantity: 2, unit: 'kg' }],
});
t.check('a never-purchased product costs 0, not NaN',
  unpriced.recipe.get('r').total_cost === 0, `${unpriced.recipe.get('r').total_cost}`);
t.check('and keeps its declared stocking unit',
  unpriced.product.get('x').pack_unit === 'kg', unpriced.product.get('x').pack_unit);

const voided = buildLiveCostIndex({
  generics: [{ id: 'v', name: 'V', base_unit: 'kg' }],
  entries: [{ generic_product_id: 'v', purchase_date: '2026-07-01', pack_qty: 1, pack_unit: 'kg', cost: 50, cost_per_unit: 50, voided_at: '2026-07-02' }],
});
t.check('a voided invoice line never prices anything',
  voided.product.get('v').cost_per_unit === 0 && voided.product.get('v').priced === false,
  JSON.stringify(voided.product.get('v')));

t.check('zero servings does not divide by zero',
  isFinite(buildLiveCostIndex({
    generics, entries, inventory: [{ item_id: 'flour', item_type: 'raw_material', quantity: 3, unit: 'kg' }],
    recipes: [{ id: 'z', servings: 0, yield_unit: 'kg' }],
    recipeItems: [{ recipe_id: 'z', product_id: 'flour', quantity: 1, unit: 'kg' }],
  }).recipe.get('z').cost_per_yield_unit));

t.done();
