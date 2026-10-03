// Static audit of public/static/analytics.js (Plausible, public pages only).
//
// The Privacy Policy and the calculator page make promises this file could
// quietly break, so each one is pinned here:
//
//   - Nothing a visitor types is read or sent: no input values, no form data,
//     no key presses. Every event carries a fixed name and fixed-shape props.
//   - It counts on foodnance.com only, and nothing at all until the Plausible
//     script address is filled in.
//   - It is on every public page and on no app page ("We do not run analytics
//     inside the signed-in app").
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (f) => readFileSync(join(PUB, f), 'utf8');
const js = read('static/analytics.js');
const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');

const t = suite('analytics');

t.section('Nothing typed is read or sent');
for (const bad of ['.value', 'FormData', 'keydown', 'keyup', 'keypress', "'input'", '"input"',
                   'querySelector(\'input', 'innerHTML', 'localStorage', 'sessionStorage', 'document.cookie',
                   'fetch(', 'XMLHttpRequest', 'sendBeacon']) {
  t.check(`the script never uses ${bad}`, !code.includes(bad));
}
const events = [...code.matchAll(/track\('([^']+)'(?:,\s*(\{[^}]*\}))?\)/g)].map(m => ({ name: m[1], props: m[2] || '' }));
t.check('every track() call was found', events.length === (code.match(/\btrack\(/g) || []).length - 1, `${events.length}`);
const ALLOWED = {
  'Request access click': ['button'],
  'FAQ opened': ['question'],
  'FAQ reached': [],
  'Calculator example': [],
  'Calculator result': ['from'],
};
for (const e of events) {
  const keys = [...e.props.matchAll(/(\w+)\s*:/g)].map(m => m[1]);
  t.check(`"${e.name}" is a known event with only its listed details`,
    ALLOWED[e.name] && keys.length === ALLOWED[e.name].length && keys.every(k => ALLOWED[e.name].includes(k)),
    keys.join(', '));
}
t.check('the calculator result is compared with its placeholder, never sent',
  /from: usedExample \? 'example' : 'own numbers'/.test(code) && !/track\([^)]*shown/.test(code));
t.check('the request form reports only the chosen plan',
  /window\.plausible\('Access request sent', \{ props: \{ plan: payload\.plan \} \}\)/.test(read('static/request-access.js')));

t.section('Counts on the live site only');
t.check('limited to foodnance.com', /LIVE_HOSTS = \['foodnance\.com', 'www\.foodnance\.com'\]/.test(code));
t.check('off unless the Plausible address is set AND the host is live',
  /var live = !!PLAUSIBLE_SRC && LIVE_HOSTS\.indexOf\(location\.hostname\) !== -1;/.test(code));
t.check('the only script it adds is the Plausible one', (code.match(/createElement\('script'\)/g) || []).length === 1 && /s\.src = PLAUSIBLE_SRC;/.test(code));
const src = (code.match(/var PLAUSIBLE_SRC = '([^']*)';/) || [])[1];
t.check('the Plausible address is empty or a plausible.io script', src === '' || /^https:\/\/plausible\.io\/js\/[\w.-]+\.js$/.test(src), src);

t.section('On every public page, on no app page');
const PUBLIC_PAGES = ['index.html', 'pricing.html', 'food-cost-calculator.html', 'refund-policy.html', 'terms.html', 'privacy.html'];
for (const f of readdirSync(PUB).filter(f => f.endsWith('.html'))) {
  const has = /\/static\/analytics\.js\?v=\d+-\d+/.test(read(f));
  if (PUBLIC_PAGES.includes(f)) t.check(`${f} loads it, with a cache-busting ?v=`, has);
  else t.check(`${f} does not load it`, !/analytics\.js|plausible/i.test(read(f)));
}

t.done();
