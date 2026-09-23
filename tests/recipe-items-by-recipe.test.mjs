// Static audit: a recipe's ingredient lines are fetched BY RECIPE, never as
// "the first N lines of the whole business, filtered in the browser".
//
// Found 2026-09-23 on a test account with 50 recipes / 224 lines: five places
// in recipes.js fetched `recipe_items?page=1&limit=200` and filtered by
// recipe_id client-side. Past 200 lines in total, a recipe's newer lines fell
// outside the batch — Garlic Oil (3 ingredients) opened showing 1, a save
// rewrote only that one and stored $0.07 instead of ~$9.37, delete would have
// orphaned the rest, and Produce Batch would have taken only part of the stock.
// tests/integration/recipe-items-by-recipe.test.mjs proves the server side.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JS   = readFileSync(join(ROOT, 'public', 'static', 'recipes.js'), 'utf8');

const t = suite('recipe-items-by-recipe');

function fnBody(name) {
  const start = JS.search(new RegExp(`(?:async )?function ${name}\\(`));
  if (start < 0) return '';
  const next = JS.slice(start + 1).search(/\n(?:async )?function /);
  return JS.slice(start, next < 0 ? undefined : start + 1 + next);
}

const helper = fnBody('fetchRecipeItemsFor');
t.check('the helper asks the server for one recipe (?recipe_id=)',
  /recipe_items|RECIPE_ITEMS_TABLE/.test(helper) && /\?recipe_id=\$\{encodeURIComponent\(recipeId\)\}/.test(helper));

for (const [fn, why] of [
  ['openRecipeDetail',     'the detail view lists every ingredient'],
  ['loadRecipeIntoForm',   'the edit form loads every ingredient'],
  ['saveRecipe',           'saving an edit replaces every old line'],
  ['deleteRecipe',         'deleting leaves no orphaned lines'],
  ['openProduceBatchModal','Produce Batch deducts every ingredient'],
]) {
  const body = fnBody(fn);
  t.check(`${fn}: ${why} (uses fetchRecipeItemsFor)`, !!body && /fetchRecipeItemsFor\(/.test(body));
  t.check(`${fn}: no whole-business recipe_items fetch filtered in the browser`,
    !/RECIPE_ITEMS_TABLE\}\?page=1&limit=\d+`\)[\s\S]{0,120}\.filter\(i => i\.recipe_id/.test(body));
}

t.check('no recipe_items fetch capped at 200 remains anywhere in recipes.js',
  !/RECIPE_ITEMS_TABLE\}\?page=1&limit=200/.test(JS) && !/recipe_items\?page=1&limit=200/.test(JS));

t.done();
