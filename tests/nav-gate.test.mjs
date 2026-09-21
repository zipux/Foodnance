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
function env({ stored, chipStored, storageThrows = false } = {}) {
  const store = new Map([
    ...(stored === undefined ? [] : [['dm_nav_features', stored]]),
    ...(chipStored === undefined ? [] : [['dm_chip_w', chipStored]]),
  ]);
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
  const names = ['DM_NAV_GATED', 'dmNavCss', 'dmNavRecall', 'dmNavRemember', 'dmNavForget', 'dmNavDropProvisional',
    'DM_NARROW_QUERY', 'dmChipCss', 'dmChipRecall', 'dmChipRemember',
    'dmChipIdentity', 'dmChipIdRemember', 'dmChipIdRecall', 'DM_CHIP_ID_KEY'];
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

// ── The chip: nothing may move when it arrives ────────────────────
t.section('Reserving the account chip\'s room');
const css = read('static/style.css');
t.check('the phone breakpoint matches style.css',
  css.includes('@media ' + api.DM_NARROW_QUERY.replace('(', '(')) && api.DM_NARROW_QUERY === '(max-width: 768px)');
t.check('the chip takes no auto margin when it follows the tabs (two auto margins split the free space)',
  /\.nav-links ~ \.session-chip \{ margin-left: 0; \}/.test(css));
t.check('an empty box the width of the chip holds its place until it exists',
  /\.navbar:not\(\.has-chip\)::after \{ content: ''; flex: 0 0 var\(--dm-chip-w\); \}/.test(css));
t.check('there is a fallback width for a first visit, and the icon-only width on phones',
  /:root \{ --dm-chip-w: 240px; \}/.test(css) && /@media \(max-width: 768px\) \{[\s\S]*?:root \{ --dm-chip-w: 107px; \}/.test(css));
t.check('utils.js marks the nav .has-chip in the same step it inserts the chip',
  /nav\.appendChild\(chip\);[\s\S]{0,700}nav\.classList\.add\('has-chip'\)/.test(utilsSrc));
t.check('and remembers the measured width with which layout it was measured in',
  /dmChipRemember\(chip\.getBoundingClientRect\(\)\.width, matchMedia\('\(max-width: 768px\)'\)\.matches\)/.test(utilsSrc));

t.check('a remembered width becomes the CSS variable', api.dmChipCss({ w: 241.4, narrow: false }, false) === ':root{--dm-chip-w:241px}');
t.check('a width from the other layout is ignored (desktop width on a phone)', api.dmChipCss({ w: 241, narrow: false }, true) === '');
t.check('...and a phone width on a desktop', api.dmChipCss({ w: 130, narrow: true }, false) === '');
for (const [label, bad] of [['null', null], ['no width', {}], ['a string', { w: '241', narrow: false }], ['NaN', { w: NaN, narrow: false }],
                            ['too small', { w: 5, narrow: false }], ['absurd', { w: 99999, narrow: false }], ['Infinity', { w: Infinity, narrow: false }]]) {
  t.check(`an unusable width (${label}) falls back to the stylesheet's`, api.dmChipCss(bad, false) === '');
}
{
  const e = env();
  e.api.dmChipRemember(241.2, false);
  t.check('remember stores width and layout only', JSON.stringify(JSON.parse(e.store.get('dm_chip_w'))) === '{"w":241,"narrow":false}');
  t.check('recall reads it back', e.api.dmChipRecall().w === 241);
  e.api.dmChipRemember(3, false); e.api.dmChipRemember(NaN, false); e.api.dmChipRemember('x', false);
  t.check('implausible widths are never stored', e.api.dmChipRecall().w === 241);
  e.api.dmNavForget();
  t.check('sign-out forgets the chip width too', e.api.dmChipRecall() === null);
  t.check('blocked storage never throws for the chip either', (() => {
    try { const b = env({ storageThrows: true }); b.api.dmChipRemember(200, false); b.api.dmChipRecall(); return true; } catch (_) { return false; }
  })());
}
{
  const e = env({ stored: JSON.stringify({ features: [] }), chipStored: JSON.stringify({ w: 250, narrow: false }) });
  const chipStyle = e.appended.find(x => x.id === 'dmChipW');
  t.check('at load, a remembered chip width is injected as --dm-chip-w', !!chipStyle && chipStyle.textContent === ':root{--dm-chip-w:250px}');
  e.api.dmNavDropProvisional();
  t.check('it is a layout variable, so the server\'s answer does NOT remove it', chipStyle.removed !== true);
  t.check('and it is separate from the tab-hiding style, which is removed',
    e.appended.find(x => x.id === 'dmNavGate').removed === true);
  t.check('no remembered width injects nothing (the stylesheet fallback applies)', !env().appended.some(x => x.id === 'dmChipW'));
  t.check('a corrupt remembered width injects nothing', !env({ chipStored: '{{' }).appended.some(x => x.id === 'dmChipW'));
}

// ── The chip's contents: drawn from memory, not after the network ──
t.section('Drawing the account chip immediately');
const CUSTOMER = { org_name: 'Pizza test', is_super_admin: false, email: 'owner@pizza.test', features: [] };
t.check('a customer is remembered by business name', JSON.stringify(api.dmChipIdentity(CUSTOMER)) === '{"label":"Pizza test","sa":false}');
t.check('the operator is remembered as "Admin"', JSON.stringify(api.dmChipIdentity({ org_name: null, is_super_admin: true, email: 'me@x.y' })) === '{"label":"Admin","sa":true}');
t.check('the EMAIL is never part of what is remembered', !JSON.stringify(api.dmChipIdentity(CUSTOMER)).includes('@'));
t.check('a customer with no business name is not remembered (their label would be their email)',
  api.dmChipIdentity({ org_name: '', is_super_admin: false, email: 'a@b.c' }) === null && api.dmChipIdentity({ is_super_admin: false, email: 'a@b.c' }) === null);
for (const [label, me] of [['null', null], ['blank name', { org_name: '   ' }], ['absurdly long name', { org_name: 'x'.repeat(81) }], ['a non-string name', { org_name: 42 }]]) {
  t.check(`no identity for ${label}`, api.dmChipIdentity(me) === null);
}
{
  const e = env();
  e.api.dmNavRemember(CUSTOMER);
  t.check('remembering a user stores the identity beside the feature list', !!e.store.get('dm_chip_id') && !!e.store.get('dm_nav_features'));
  t.check('and the stored identity holds no email', !e.store.get('dm_chip_id').includes('@') && !e.store.get('dm_nav_features').includes('@'));
  t.check('recall returns it', JSON.stringify(e.api.dmChipIdRecall()) === '{"label":"Pizza test","sa":false}');
  e.api.dmNavForget();
  t.check('sign-out forgets the name as well', e.api.dmChipIdRecall() === null && !e.store.has('dm_chip_id'));
  for (const bad of ['not json', '{}', '{"label":"x"}', '{"label":"","sa":false}', '{"label":"x","sa":"no"}', 'null', '[]']) {
    e.store.set('dm_chip_id', bad);
    t.check(`a stored value shaped like ${JSON.stringify(bad)} is ignored`, e.api.dmChipIdRecall() === null);
  }
  const b = env({ storageThrows: true });
  t.check('blocked storage never throws for the identity either', (() => { try { b.api.dmChipIdRemember(CUSTOMER); b.api.dmChipIdRecall(); return true; } catch (_) { return false; } })());
}
{
  // The hazard of drawing from memory: showing the WRONG name. The server's answer must win.
  const draw = utilsSrc.indexOf('\ndrawSessionChipFromMemory();');
  const listener = utilsSrc.indexOf("document.addEventListener('DOMContentLoaded', renderSessionChip);");
  t.check('utils.js draws from memory as soon as it loads, before the DOM-ready handler', draw > 0 && listener > draw);
  t.check('the memory-drawn chip is marked as a draft, so it is never mistaken for a confirmed one',
    /chip\.dataset\.draft = '1';\s*nav\.appendChild\(chip\)/.test(utilsSrc));
  t.check('renderSessionChip still runs for a draft chip but skips a confirmed one',
    /let chip = document\.getElementById\('sessionChip'\);\s*if \(chip && !chip\.dataset\.draft\) return;/.test(utilsSrc));
  t.check('the server\'s answer corrects the draft in place and clears the flag',
    /if \(chip\) \{\s*updateSessionChip\(chip, me\);\s*delete chip\.dataset\.draft;/.test(utilsSrc));
  t.check('a signed-out answer removes the remembered chip and forgets the name',
    /if \(!me\) \{[\s\S]{0,260}chip\.remove\(\);[\s\S]{0,120}dmNavForget\(\)/.test(utilsSrc));
  t.check('an offline load keeps the chip it drew (the request failing is not "signed out")',
    /catch \(_\) \{ return; \}\s*\/\/ offline: keep whatever was drawn/.test(utilsSrc));
  t.check('the label is HTML-escaped wherever it is put in markup', /<span>\$\{esc\(label\)\}<\/span>/.test(utilsSrc) && !/<span>\$\{label\}<\/span>/.test(utilsSrc));
  t.check('updateSessionChip writes the label with textContent, never as HTML',
    /\.session-who > span'\)\.textContent =/.test(utilsSrc));
  t.check('the tooltip email is only added once the server has answered',
    /<span class="session-who"\$\{email \? ` title="\$\{esc\(email\)\}"` : ''\}>/.test(utilsSrc));
  const gateSrc = read('static/nav-gate.js');
  const idFn = gateSrc.slice(gateSrc.indexOf('function dmChipIdentity'), gateSrc.indexOf('function dmChipIdRemember'));
  t.check('the code that decides what to remember never reads an email', !/email/.test(idFn), idFn.match(/.*email.*/)?.[0]);
}

// ── Wiring ────────────────────────────────────────────────────────
t.section('Wired into every page');
for (const page of pages) {
  const html = read(page);
  const head = html.slice(0, html.indexOf('</head>'));
  t.check(`${page}: nav-gate.js is loaded synchronously in <head>`,
    /<script src="\/static\/nav-gate\.js\?v=\d+-\d+"><\/script>/.test(head) && !/nav-gate\.js[^>]*(async|defer)/.test(head));
}
// One cache-buster per shared file, the same on every page: a page left on an old
// ?v= keeps serving the old script from the CDN (see CLAUDE.md), which here would
// mean a nav that jumps or flashes on that one page only.
for (const file of ['utils.js', 'style.css', 'nav-gate.js']) {
  const versions = new Set(pages.map(p => (read(p).match(new RegExp(file.replace('.', '\\.') + '\\?v=([0-9-]+)')) || [])[1]));
  t.check(`every app page loads ${file} with the same ?v=`, versions.size === 1 && !versions.has(undefined), [...versions].join(', '));
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
