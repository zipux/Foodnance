// The live cost index must repaint the list it feeds — public/static/*.js
//
// The bug this guards, seen in production as "all my recipes show $0 but the
// detail modal shows the right cost":
//
// Each page loads its catalogue and its saved list CONCURRENTLY, via
// Promise.all. The list is one small fetch; the catalogue is four (recipes) or
// six (finished products) including two limit=1000 payloads. So the list
// resolves first, renders off a cost index that is still empty, and prints
// $0.00. The catalogue then lands and rebuilds the index correctly — but
// nothing repainted, so the stale $0 stayed on screen. The detail modals looked
// right because they recalculate when opened, long after everything has loaded.
//
// It only reproduces under real latency: on localhost with a small dataset the
// race usually resolves the other way, which is exactly why this needs a guard
// that does not depend on timing. The invariant is simple and checkable:
// whichever loader finishes second must redraw the list.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const STATIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'static');
const t = suite('cost-index-repaint');

// Pull one function's body out of a source file.
function body(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return null;
  let depth = 0, i = src.indexOf('{', start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  return null;
}

const cases = [
  { file: 'recipes.js',           rebuild: 'rebuildRecipeCostIndex', render: 'renderRecipeList',
    loader: 'loadProductCatalogue' },
  { file: 'finished-products.js', rebuild: 'rebuildFpCostIndex',     render: 'renderFpList',
    loader: 'loadFpCatalogues' },
];

for (const c of cases) {
  const src = readFileSync(join(STATIC, c.file), 'utf8');

  t.section(`${c.file}`);

  const rebuild = body(src, c.rebuild);
  t.check(`${c.rebuild}() exists`, !!rebuild);

  // THE INVARIANT. Without this call the list keeps whatever it drew first.
  t.check(`${c.rebuild}() repaints via ${c.render}()`,
    !!rebuild && rebuild.includes(`${c.render}(`),
    'rebuilding the index without repainting leaves a stale $0 list on screen');

  // The repaint must be guarded, or an early rebuild (before the saved list has
  // loaded) would render an empty list over the loading state.
  t.check(`${c.rebuild}() guards the repaint`,
    !!rebuild && /if\s*\(/.test(rebuild),
    'repaint must be conditional on the list having loaded');

  // And the catalogue loader must actually call the rebuild — that is the
  // second-finisher path the whole fix depends on.
  const loader = body(src, c.loader);
  t.check(`${c.loader}() rebuilds the index when it finishes`,
    !!loader && loader.includes(`${c.rebuild}()`),
    `${c.loader} must rebuild, or a late catalogue never reaches the list`);

  // Both loaders run inside one Promise.all, which is what makes the order
  // undefined. If that ever becomes sequential this guard can be relaxed —
  // until then, the race is real.
  t.check(`${c.file} still loads catalogue and list concurrently`,
    new RegExp(`Promise\\.all\\(\\[[^\\]]*${c.loader}\\(\\)`).test(src),
    'if this became sequential, the repaint guard could be revisited');
}

t.section('the list must not read the stored snapshot columns');
// A tempting "fix" for the $0 is to fall back to recipes.total_cost, which would
// hide the race behind a stale number instead of correcting it.
const rec = readFileSync(join(STATIC, 'recipes.js'), 'utf8');
const list = body(rec, 'renderRecipeList');
t.check('renderRecipeList() does not read total_cost directly',
  !!list && !/\br\.total_cost\b/.test(list),
  'the list must use the live index, not the frozen snapshot');

t.done();
