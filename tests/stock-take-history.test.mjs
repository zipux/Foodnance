// Static audit: past stock counts are read only (2026-10-06).
//
// A submitted count set the shelf, and every movement since and each month's
// true COGS were built on it. The history may show a count and carry a note;
// it must have no way to change a figure, and its value must come from the
// same code as the P&L's.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');
const page = readFileSync(join(ROOT, 'public/static/stock-take.js'), 'utf8');
const html = readFileSync(join(ROOT, 'public/stock-take.html'), 'utf8');
const t = suite('stock-take-history');

const routeStarts = [...src.matchAll(/^app\.(get|post|put|patch|delete)\(\s*'([^']+)'/gm)];
function handlerBody(method, path) {
  const idx = routeStarts.findIndex(m => m[1] === method && m[2] === path);
  if (idx === -1) return null;
  const end = idx + 1 < routeStarts.length ? routeStarts[idx + 1].index : src.length;
  return src.slice(routeStarts[idx].index, end);
}
const list = handlerBody('get', '/api/stock-take/history');
const one  = handlerBody('get', '/api/stock-take/history/:id');
// Cut at the handler's own closing brace: the slice otherwise runs on into the
// comment above the next route.
const noteRaw = handlerBody('post', '/api/stock-take/history/:id/note');
const note = noteRaw ? noteRaw.slice(0, noteRaw.indexOf('\n})\n') + 4) : null;

t.section('the routes exist, and only read');
t.check('list, one count, note', !!list && !!one && !!note);
t.check('the list and the count write nothing', !/INSERT|UPDATE|DELETE/.test(list) && !/INSERT|UPDATE|DELETE/.test(one));
t.check('only submitted counts are listed or opened',
  /status = 'submitted'/.test(list) && /status = 'submitted'/.test(one) && /status = 'submitted'/.test(note));
t.check('the list is declared before the :id route, or "history" would be read as an id',
  routeStarts.findIndex(m => m[2] === '/api/stock-take/history') < routeStarts.findIndex(m => m[2] === '/api/stock-take/history/:id'));
const historyRoutes = routeStarts.filter(m => m[2].startsWith('/api/stock-take/history')).map(m => `${m[1]} ${m[2]}`);
t.check('there is no route to re-open, edit or delete a past count', historyRoutes.length === 3, historyRoutes.join(', '));

t.section('the note changes nothing else');
const updates = note.match(/UPDATE stock_takes SET ([^`]*?) WHERE/);
t.check('it sets the note column and no other', !!updates && updates[1].trim() === 'note = ?', updates && updates[1]);
t.check('on the caller\'s own organization', /org_id IS \?/.test(note) && /orgOf\(c\)/.test(note));
t.check('it touches no stock or lines', !/inventory|stock_log|stock_take_items/.test(note));
t.check('length is capped', /\.slice\(0, 1000\)/.test(note));

t.section('one valuation for the history and the P&L');
const pnl = handlerBody('get', '/api/pnl');
t.check('the P&L values counts through stockValuer', /const valuer = stockValuer\(c\.env\.DB, org\)/.test(pnl));
t.check('the list does too', /stockValuer\(c\.env\.DB, org\)/.test(list) && /valuer\.valueTake\(t\.id, t\.d\)/.test(list));
t.check('so does the opened count, differences included',
  /valuer\.valueTake\(take\.id, take\.d\)/.test(one) && /valuer\.valueRows\(/.test(one));
t.check('there is one copy of the pricing rule', (src.match(/const priceInto = /g) || []).length === 1);
t.check('a count is dated by the restaurant\'s own day, as in the P&L', /\$\{STOCK_TAKE_DAY\} AS d/.test(list) && /\$\{STOCK_TAKE_DAY\} AS d/.test(one)
  && /const STOCK_TAKE_DAY = `COALESCE\(count_date, date\(submitted_at\)\)`/.test(src));

t.section('the page');
const hist = page.slice(page.indexOf('// PAST COUNTS'), page.indexOf('function todayYMD'));
t.check('the list loads when no count is in progress', /Nothing in progress[\s\S]{0,400}loadHistory\(\);/.test(page));
t.check('the opened count has no quantity inputs', !/<input/.test(hist) && !/<select/.test(hist));
t.check('the only request that writes is the note', (hist.match(/method: 'POST'/g) || []).length === 1 && /\/note`/.test(hist));
t.check('it says it cannot be changed', /They cannot be changed\./.test(html) && /Read only/.test(hist));
t.check('a failed list never breaks the page', /catch \(_\) \{ return; \}/.test(hist));
t.check('everything the server sends is escaped', !/\$\{t\.note\}|\$\{i\.item_name\}|\$\{i\.reason\}|\$\{take\.note\}/.test(hist));

t.section('there is a way to reach it');
const invHtml = readFileSync(join(ROOT, 'public/inventory.html'), 'utf8');
t.check('the Inventory page has a Past Counts button', /href="\/stock-take\.html\?history=1"[^>]*id="pastCountsBtn"/.test(invHtml) && /Past Counts/.test(invHtml));
t.check('it does not start a count', !/history=1[^"]*start=1|start=1[^"]*history=1/.test(invHtml));
const boot = page.slice(page.indexOf('async function loadOrStart'), page.indexOf('async function loadOrStart') + 1600);
t.check('the page shows the list when asked, before looking for a count in progress',
  boot.indexOf("get('history') === '1'") > -1 && boot.indexOf("get('history') === '1'") < boot.indexOf('/api/stock-take/active'));
t.check('an empty list says so when it was asked for', /No counts submitted yet/.test(page));

t.section('a reason for a difference is optional');
const submit = page.slice(page.indexOf('async function submitStockTake'), page.indexOf('function openSubmitSummary'));
t.check('submitting no longer stops on a missing reason', !/Select a reason/.test(page) && !/missing\.length/.test(submit));
t.check('the picker says so', /<option value="">Reason \(optional\)<\/option>/.test(page));
t.check('the server files an unexplained difference as a stock-take difference', /reasonCode \|\| 'stock_take'/.test(src));

t.done();
