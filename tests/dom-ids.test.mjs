// Element-id cross-check: every literal getElementById('x') in a page's OWN
// controller must correspond to an id="x" in that page's HTML.
//
// The frontend is plain <script> files against static HTML, so a renamed id
// fails silently at runtime — no build step catches it. This is the cheapest
// guard against that whole class of breakage.
//
// Only each page's own controller is checked: shared scripts (utils.js,
// inventory.js) are loaded on many pages and legitimately reference ids that
// live elsewhere. Ids built dynamically (template literals) can't be resolved
// statically and are skipped; ids created via innerHTML are listed as known
// exceptions below.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const PAGES = [
  ['products.html',          'products.js'],
  ['home.html',              'home.js'],
  ['inventory.html',         'inventory.js'],
  ['invoices.html',          'invoices.js'],
  ['sales.html',             'sales.js'],
  ['recipes.html',           'recipes.js'],
  ['finished-products.html', 'finished-products.js'],
];

// Ids the controller creates at runtime via innerHTML, so they are never in
// the static HTML. Verified by hand — see invoices.js invoice viewer.
const CREATED_AT_RUNTIME = new Set([
  'invPageFrame', 'invZoomImg', 'invPageLabel',
  'invPagePrev', 'invPageNext', 'invImgZoomWrap',
  // "Close anyway" override, injected into the static #totalMismatchNote
  // container by renderTotalMismatchNote(). Clearing that container on invoice
  // open is what resets the override.
  'totalMismatchOverride',
]);

const t = suite('dom-ids');

for (const [page, script] of PAGES) {
  const html = readFileSync(join(ROOT, page), 'utf8');
  const js   = readFileSync(join(ROOT, 'static', script), 'utf8');

  const ids  = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const refs = new Set([...js.matchAll(/getElementById\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)/g)].map(m => m[1]));

  const missing = [...refs].filter(id => !ids.has(id) && !CREATED_AT_RUNTIME.has(id));
  t.check(`${page} <-> ${script} (${refs.size} ids)`, missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : '');
}

t.done();
