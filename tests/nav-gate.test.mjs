// nav-gate.js — hiding the tabs a plan lacks BEFORE first paint.
//
// The bug it fixes: an Essential customer saw Inventory, Sales, Staff and the
// other Pro tabs flash on screen for a moment on every page load, until
// /api/auth/me answered and utils.js hid them. The fix remembers the last feature
// list in the browser and hides the tabs from a <head> script.
//
// What must not go wrong, and is checked below:
//   - The two lists of gated pages (nav-gate.js and utils.js) must be the same, or
//     a tab is hidden early that the server then shows, or the reverse.
//   - The generated CSS must actually match the links the pages contain. A
//     selector that misses by one character silently restores the flash.
//   - It must FAIL OPEN: nothing remembered, or something unreadable, shows every
//     tab exactly as before. Hiding a tab wrongly is worse than a flicker.
//   - Signing out must forget, and every page must load the script in <head>.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (f) => readFileSync(join(PUB, f), 'utf8');
const t = suite('nav-gate');

// A localStorage that can be made to misbehave, and a document that records
// what gets appended to <head>.
function env({ stored, storageThrows = false } = {}) {
  const store = new Map(stored === undefined ? [] : [['dm_nav_features', stored]]);
  const appended = [];
  const localStorage = {
    getItem: (k) => { if (storageThrows) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (storageThrows) throw new Error('blocked'); store.set(k, String(v)); },
    removeItem: (k) => { if (storageThrows) throw new Error('blocked'); store.delete(k); },
  };
  const document = {
    head: { appendChild: (el) => appended.push(el) },
    createElement: () => ({ remove() { this.removed = true; } }),
    getElementById: (id) => appended.find(e => e.id === id) || null,
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], body: {},
  };
  const names = ['DM_NAV_GATED', 'dmNavCss', 'dmNavRecall', 'dmNavRemember', 'dmNavForget', 'dmNavDropProvisional'];
  const api = loadBrowserModule(['nav-gate.js'], names, { localStorage, document });
  return { api, store, appended };
}

const ESSENTIAL = [];   // planFeatures('essential') — Pro adds everything gated
const PRO = ['inventory_tools', 'stock_takes', 'storage_layout', 'staff', 'true_cogs', 'pos_sales'];
const { api } = env();

// ── The two lists agree ───────────────────────────────────────────
t.section('nav-gate.js and utils.js gate the same pages');
const utilsSrc = read('static/utils.js');
const block = utilsSrc.match(/const PLAN_GATED_PAGES = \{([\s\S]*?)\n\};/)[1];
const utilsGate = Object.fromEntries([...block.matchAll(/'(\/[a-z-]+)':\s*\{\s*feature:\s*'([a-z_]+)'/g)].map(m => [m[1], m[2]]));
t.check('utils.js list was parsed', Object.keys(utilsGate).length >= 6, JSON.stringify(utilsGate));
t.check('identical paths and features', JSON.stringify(utilsGate) === JSON.stringify(api.DM_NAV_GATED),
  `utils ${JSON.stringify(utilsGate)} vs nav-gate ${JSON.stringify(api.DM_NAV_GATED)}`);

// ── The CSS ───────────────────────────────────────────────────────
t.section('The CSS it generates');
const essentialCss = api.dmNavCss(ESSENTIAL);
for (const path of Object.keys(api.DM_NAV_GATED)) {
  t.check(`Essential hides ${path} (both .html and extensionless)`,
    essentialCss.includes(`.nav-links a[href="${path}.html"]`) && essentialCss.includes(`.nav-links a[href="${path}"]`));
}
t.check('the rule is display:none', /\{display:none !important\}$/.test(essentialCss));
t.check('Pro has every feature, so nothing is hidden', api.dmNavCss(PRO) === '');
const partial = api.dmNavCss(['staff']);
t.check('a plan with only "staff" still hides Sales, Inventory, Stock Takes, Storage Layout',
  ['/sales', '/inventory', '/stock-take', '/storage-layout'].every(p => partial.includes(`a[href="${p}.html"]`)));
t.check('...but keeps Staff and Certifications', !partial.includes('a[href="/staff.html"]') && !partial.includes('a[href="/certifications.html"]'));
t.check('never touches ungated tabs',
  !/(home|upload-invoice|invoices|pnl|products|recipes|finished-products|suppliers|settings)/.test(essentialCss));

t.section('Fail open: anything unreadable shows every tab');
for (const [label, v] of [['null', null], ['undefined', undefined], ['a string', 'staff'], ['an object', { features: [] }], ['a number', 3]]) {
  t.check(`features = ${label} → no CSS`, api.dmNavCss(v) === '');
}
t.check('non-string entries are ignored, not trusted', api.dmNavCss([1, null, {}]) !== '' && api.dmNavCss([1, null, {}]).includes('a[href="/staff.html"]'));

// ── Every real nav link is matched ────────────────────────────────
t.section('The selectors match the links the pages actually contain');
const pages = readdirSync(PUB).filter(f => f.endsWith('.html')).filter(f => read(f).includes('class="nav-links"'));
t.check('found the app pages', pages.length >= 15, `${pages.length}`);
let seenGated = new Set();
for (const page of pages) {
  const nav = read(page).match(/<div class="nav-links">([\s\S]*?)<\/div>/)[1];
  for (const m of nav.matchAll(/<a href="([^"]+)"/g)) {
    const href = m[1];
    const path = href.replace(/\.html$/, '');
    const gated = Object.prototype.hasOwnProperty.call(api.DM_NAV_GATED, path);
    if (gated) {
      seenGated.add(path);
      t.check(`${page}: ${href} is hidden for Essential`, essentialCss.includes(`.nav-links a[href="${href}"]`));
    } else {
      t.check(`${page}: ${href} (not gated) stays visible`, !essentialCss.includes(`a[href="${href}"]`));
    }
  }
}
// Stock Take, Storage Layout and Certifications are not in the top nav — they are
// reached from inside other pages — so they are gated in the list (for the
// upgrade panel) but there is no nav link for this file to hide. The three that
// ARE in the nav must all have been seen, or the loop above proved nothing.
t.check('the gated tabs that live in the nav were all found and checked',
  ['/sales', '/inventory', '/staff'].every(p => seenGated.has(p)),
  `seen: ${[...seenGated].join(', ')}`);

// ── Remembering ───────────────────────────────────────────────────
t.section('Remembering and forgetting');
{
  const e = env();
  e.api.dmNavRemember({ features: ['staff'] });
  t.check('remember stores the feature list', JSON.parse(e.store.get('dm_nav_features')).features[0] === 'staff');
  t.check('and nothing else about the user', Object.keys(JSON.parse(e.store.get('dm_nav_features'))).join() === 'features');
  t.check('recall returns it', e.api.dmNavRecall().join() === 'staff');
  e.api.dmNavRemember({ features: [] });
  t.check('an empty list (Essential) is remembered, not treated as "unknown"', Array.isArray(e.api.dmNavRecall()) && e.api.dmNavRecall().length === 0);
  e.api.dmNavRemember({ plan: 'pro' });
  t.check('a user with no features array does not overwrite what was stored', Array.isArray(e.api.dmNavRecall()));
  e.api.dmNavRemember(null);
  t.check('remember(null) is harmless', true);
  e.api.dmNavForget();
  t.check('forget removes it (sign-out)', e.api.dmNavRecall() === null && !e.store.has('dm_nav_features'));
}
for (const bad of ['not json', '{"features":"staff"}', '[]', '', 'null']) {
  t.check(`unreadable stored value ${JSON.stringify(bad)} → recall is null`, env({ stored: bad }).api.dmNavRecall() === null);
}
{
  const e = env({ storageThrows: true });
  let threw = false;
  try { e.api.dmNavRemember({ features: [] }); e.api.dmNavRecall(); e.api.dmNavForget(); } catch (_) { threw = true; }
  t.check('blocked storage (private mode) never throws', !threw);
}

// ── What runs at load ─────────────────────────────────────────────
t.section('At page load');
{
  const essential = env({ stored: JSON.stringify({ features: [] }) });
  t.check('an Essential memory injects one <style> into <head>', essential.appended.length === 1);
  t.check('with the id the server answer removes', essential.appended[0].id === 'dmNavGate');
  t.check('and the Essential CSS', essential.appended[0].textContent === api.dmNavCss([]));
  essential.api.dmNavDropProvisional();
  t.check('dmNavDropProvisional removes it', essential.appended[0].removed === true);
  t.check('a Pro memory injects nothing', env({ stored: JSON.stringify({ features: PRO }) }).appended.length === 0);
  t.check('no memory injects nothing (first ever visit shows every tab, as before)', env().appended.length === 0);
  t.check('a corrupt memory injects nothing', env({ stored: '{{' }).appended.length === 0);
}

// ── Wiring ────────────────────────────────────────────────────────
t.section('Wired into every page');
for (const page of pages) {
  const html = read(page);
  const head = html.slice(0, html.indexOf('</head>'));
  t.check(`${page}: nav-gate.js is loaded synchronously in <head>`,
    /<script src="\/static\/nav-gate\.js\?v=\d+-\d+"><\/script>/.test(head) && !/nav-gate\.js[^>]*(async|defer)/.test(head));
  t.check(`${page}: utils.js carries the current cache-buster`, /utils\.js\?v=20260921-1/.test(html));
}
const login = read('login.html'), admin = read('admin.html');
t.check('login.html loads it and seeds the memory from the login response',
  /nav-gate\.js/.test(login) && /dmNavRemember\(data\.user\)/.test(login));
t.check('admin.html loads it and forgets on sign-out', /nav-gate\.js/.test(admin) && /dmNavForget\(\)/.test(admin));
t.check('utils.js remembers after /api/auth/me', /dmNavRemember\(me\)/.test(utilsSrc));
t.check('utils.js drops the provisional hiding when the server answers',
  /function applyPlanGating\(me\) \{[\s\S]{0,400}dmNavDropProvisional\(\)/.test(utilsSrc));
t.check('utils.js forgets on sign-out, after the logout succeeded',
  /if \(!r\.ok\) throw new Error\('logout failed'\);\s*if \(typeof dmNavForget === 'function'\) dmNavForget\(\);/.test(utilsSrc));
t.check('the calls are guarded, so a page without nav-gate.js still works', (utilsSrc.match(/typeof dmNav\w+ === 'function'/g) || []).length >= 3);

t.done();
