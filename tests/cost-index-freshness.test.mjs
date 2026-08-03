// Static audit: after writing a bill of materials, re-read it before repainting.
//
// The bug this pins, reported on Lucca 2026-08-04: save a recipe, and the list
// shows $0 until the page is reloaded.
//
// Costs are derived at read time from the recipe_items / finished_product_items
// arrays held in memory, and those arrays are only fetched by the page's
// catalogue loader at startup. Saving writes the lines server-side and then
// calls loadRecipes(), which refreshes the recipe ROWS and rebuilds the index —
// off the stale item arrays. The index therefore sees a recipe with no
// ingredients and honestly reports $0. Reloading the page refetched the
// catalogue, which is why it "fixed itself".
//
// The failure is quiet in the worst way: $0 is a plausible number, and the
// detail modal recalculates on open so it shows the RIGHT figure. The two
// disagreeing is the only tell.
//
// So: every path that mutates a bill of materials must refresh the items before
// the list reload. This checks the call ORDER, since refreshing afterwards
// repaints from the same stale data.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'static');

const t = suite('cost-index-freshness');

// [file, refresh fn, list reload fn, functions that mutate the bill of materials]
const CASES = [
  ['recipes.js', 'refreshRecipeItems', 'loadRecipes', ['saveRecipe', 'deleteRecipe']],
  ['finished-products.js', 'refreshFpItems', 'loadFinishedProducts', ['saveFp', 'deleteFp']],
];

for (const [file, refresh, reload, mutators] of CASES) {
  const src = readFileSync(join(ROOT, file), 'utf8');

  t.section(file);
  t.check(`${refresh}() exists`, new RegExp(`async function ${refresh}\\s*\\(`).test(src));

  for (const fn of mutators) {
    // Body of the mutating function, up to the next top-level declaration.
    const m = src.match(new RegExp(`async function ${fn}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
    if (!m) { t.check(`${fn}() found`, false, 'could not locate the function'); continue; }

    const body = m[1];
    const r = body.indexOf(`${refresh}(`);
    const l = body.indexOf(`${reload}(`);

    t.check(`${fn}() reloads the list`, l !== -1);
    t.check(`${fn}() refreshes the items`, r !== -1,
      `${fn} calls ${reload}() without ${refresh}() — the list will repaint at $0`);
    t.check(`${fn}() refreshes BEFORE reloading`, r !== -1 && l !== -1 && r < l,
      `refresh@${r} reload@${l}`);
  }
}

t.done();
