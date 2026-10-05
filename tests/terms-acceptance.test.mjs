// Static audit: the Terms acceptance record (2026-10-06, migration 0061).
//
// The record is only worth having if it can't be skipped and can't be faked:
// the server refuses a sign-up without the agreement, existing people are asked
// once, and the version written down is the Terms page's own date.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT   = join(dirname(fileURLToPath(import.meta.url)), '..');
const read   = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const src    = read('src', 'index.ts');
const accept = read('public', 'accept-invite.html');
const utils  = read('public', 'static', 'utils.js');
const terms  = read('public', 'terms.html');
const mig    = read('migrations', '0061_terms_acceptance.sql');

const t = suite('terms-acceptance');

const routeStarts = [...src.matchAll(/^app\.(get|post|put|patch|delete)\(\s*'([^']+)'/gm)];
function handlerBody(method, path) {
  const idx = routeStarts.findIndex(m => m[1] === method && m[2] === path);
  if (idx === -1) return null;
  const end = idx + 1 < routeStarts.length ? routeStarts[idx + 1].index : src.length;
  return src.slice(routeStarts[idx].index, end);
}

t.section('the version is the Terms page\'s own date');
const version = (/const TERMS_VERSION = '(\d{4}-\d{2}-\d{2})'/.exec(src) || [])[1];
const shown = /Last updated: (\d{1,2}) (\w+) (\d{4})/.exec(terms);
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const shownIso = shown
  ? `${shown[3]}-${String(MONTHS.indexOf(shown[2]) + 1).padStart(2, '0')}-${shown[1].padStart(2, '0')}`
  : null;
t.check('TERMS_VERSION is defined', !!version);
t.check('it equals "Last updated" on terms.html', !!version && version === shownIso, `${version} vs ${shownIso}`);

t.section('the columns');
t.check('terms_version on users', /ALTER TABLE users ADD COLUMN terms_version/.test(mig));
t.check('terms_accepted_at on users, NULL by default (nobody is recorded without agreeing)',
  /ALTER TABLE users ADD COLUMN terms_accepted_at TEXT DEFAULT NULL/.test(mig));

t.section('signing up');
const signup = handlerBody('post', '/api/auth/accept-invite');
t.check('the server refuses without the agreement', !!signup && /if \(body\.agree !== true\) return c\.json\(\{ error: TERMS_REQUIRED \}, 400\)/.test(signup));
t.check('the refusal comes before the user is written',
  !!signup && signup.indexOf('body.agree !== true') < signup.indexOf('INSERT INTO users'));
t.check('the user row carries the version and the time',
  !!signup && /INSERT INTO users \([^)]*terms_version, terms_accepted_at\)/.test(signup) && /TERMS_VERSION\)/.test(signup));
t.check('the page has a required tick box', /<input type="checkbox" id="agree" required/.test(accept));
t.check('it links both documents', /href="\/terms"/.test(accept) && /href="\/privacy"/.test(accept));
t.check('the page sends the answer, not a fixed true', /\n\s+agree,\n/.test(accept) && !/agree:\s*true/.test(accept));

t.section('people who already had an account');
const once = handlerBody('post', '/api/auth/accept-terms');
t.check('route exists', !!once);
t.check('needs a session', !!once && /currentUser\(c\)/.test(once) && /Not signed in/.test(once));
t.check('needs the agreement', !!once && /body\.agree !== true/.test(once));
t.check('writes only the caller\'s own row, and keeps the first record',
  !!once && /WHERE id = \? AND terms_accepted_at IS NULL/.test(once) && /bind\(TERMS_VERSION, me\.id\)/.test(once));
t.check('not public', !/'\/api\/auth\/accept-terms'[^\n]*\n(?:[^\]]*\n)*?\]\)/.test(src.slice(src.indexOf('const PUBLIC_API'), src.indexOf('const SUSPEND_EXEMPT'))));
t.check('a paused account can still get past the panel',
  /'\/api\/auth\/accept-terms'/.test(src.slice(src.indexOf('const SUSPEND_EXEMPT'), src.indexOf("app.use('/api/*'"))));
const me = handlerBody('get', '/api/auth/me');
t.check('/me says whether to ask', !!me && /terms_due/.test(me));
const due = src.slice(src.indexOf('async function termsDue'), src.indexOf('function publicUser'));
t.check('a super-admin is never asked', /role === 'super_admin'\) return false/.test(due));
t.check('a database without the columns cannot break sign-in', /catch \(_\) \{\s*return false/.test(due));
t.check('the session columns are untouched', !/terms_/.test(src.slice(src.indexOf('const SESSION_USER_COLUMNS'), src.indexOf('const SESSION_USER_COLUMNS') + 900)));
const gate = utils.slice(utils.indexOf('function renderTermsGate'), utils.indexOf('function renderViewingAsBar'));
t.check('the app shows the panel when asked', /if \(me\.terms_due\) renderTermsGate\(\)/.test(utils));
t.check('the panel only closes once the record is saved',
  /if \(!r\.ok\) throw new Error\('refused'\);\s*gate\.remove\(\)/.test(gate) && (gate.match(/gate\.remove\(\)/g) || []).length === 1);
t.check('it offers a way out', /terms-gate-signout/.test(gate) && /\/api\/auth\/logout/.test(gate));

t.done();
