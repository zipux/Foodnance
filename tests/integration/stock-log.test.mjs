// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run build && npm run dev:sandbox     (in another terminal)
//   npm run test:stock-log
//
// The stock movement log: filtered by the server (dates, one item, a search,
// the kind of movement), "Stock after" worked back from the shelf, a line's
// link to its invoice or count, and the log as history — lines can be added
// but never changed or deleted, and outlive the item they belong to.
//
// Self-contained: creates its own businesses per run.
import { suite } from '../helpers/assert.mjs';

const BASE  = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);

function jar() { return { cookies: {} }; }
function jarHeader(j) {
  const p = Object.entries(j?.cookies || {}).filter(([, v]) => v !== '');
  return p.length ? p.map(([k, v]) => `${k}=${v}`).join('; ') : '';
}
function absorb(j, res) {
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of raw) {
    const [pair] = String(line).split(';');
    const i = pair.indexOf('='); if (i < 0) continue;
    j.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}
async function call(j, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(jarHeader(j) ? { cookie: jarHeader(j) } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  absorb(j, res);
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

const t = suite('integration/stock-log');
try { await fetch(`${BASE}/api/auth/me`); } catch (_) {
  console.log(`\n  no server at ${BASE} — skipping (run: npm run dev:sandbox)\n`); process.exit(0);
}
const admin = jar();
const login = await call(admin, 'POST', '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
if (login.status !== 200) { console.log('\n  no super-admin session — skipping\n'); process.exit(0); }
async function business(tag, plan) {
  const o = { name: `Log ${tag} ${STAMP}`, email: `log-${tag}-${STAMP}@test.local`, password: 'log-pw-1' };
  const org = await call(admin, 'POST', '/api/admin/organizations',
    { name: o.name, owner_email: o.email, owner_password: o.password, account_type: 'restaurant' });
  const id = org.data.organization.id;
  if (plan === 'pro') await call(admin, 'POST', `/api/admin/organizations/${id}/plan`, { plan: 'pro' });
  await call(admin, 'POST', `/api/admin/organizations/${id}/review-mode`, { mode: 'direct' });
  const j = jar();
  await call(j, 'POST', '/api/auth/login', { email: o.email, password: o.password });
  return j;
}
const u = await business('a', 'pro');
const other = await business('b', 'pro');
const essential = await business('c', 'essential');

const mk = async (name, qty) => {
  const p = (await call(u, 'POST', '/api/tables/generic_products', { name, category: 'Dairy & Eggs', base_unit: 'kg' })).data.id;
  const bin = (await call(u, 'POST', '/api/tables/inventory',
    { item_id: p, item_type: 'raw_material', item_name: name, category: 'Dairy & Eggs', quantity: qty, unit: 'kg' })).data.id;
  return { p, bin };
};
const cheese = await mk('LG Mozzarella', 0);
const cream  = await mk('LG Cream', 5);
// A line written the way the app's own pages write one, at a chosen moment.
const days = (n) => new Date(Date.now() - n * 86400000).toISOString();
const move = async (item, change, reason, when, extra = {}) => {
  const cur = Number((await call(u, 'GET', `/api/tables/inventory/${item.bin}`)).data.quantity);
  await call(u, 'PATCH', `/api/tables/inventory/${item.bin}`, { quantity: Math.round((cur + change) * 1e6) / 1e6 });
  return call(u, 'POST', '/api/tables/stock_log', { inventory_id: item.bin, item_id: item.p, item_type: 'raw_material',
    item_name: item === cheese ? 'LG Mozzarella' : 'LG Cream', change, reason, moved_at: when, ...extra });
};
const inv = (await call(u, 'POST', '/api/tables/invoices', { vendor: 'Alpine', invoice_number: `AD-${STAMP}`, invoice_date: '2026-10-01', total: 10 })).data.id;
await move(cheese, 3.2, 'Stock-in from product entry', days(50));          // older than the default 30 days
await move(cheese, 10, `Invoice stock-in: AD-${STAMP}`, days(6));          // 13.2
await move(cheese, -2.4, 'Batch production: LG Pizza', days(5));           // 10.8
await move(cheese, 10, `Invoice stock-in: AD-${STAMP}`, days(4));          // 20.8  (the same invoice, twice)
await move(cream, -1, 'Batch production: LG Pizza', days(4));              //  4
await call(u, 'POST', `/api/inventory/${cheese.bin}/waste`, { qty: 0.5, reason_code: 'spillage', note: 'Tray dropped' });   // 20.3
const rc = await call(u, 'POST', `/api/inventory/${cheese.bin}/recount`, { counted_qty: 9 });                             //  9

const log = async (qs = '', j = u) => (await call(j, 'GET', `/api/stock-log${qs}`));
const iso = encodeURIComponent;

t.section('the default: the last 30 days, newest first');
const d = (await log()).data;
t.check('six lines, not the one from 50 days ago', d.data.length === 6 && !d.data.some(l => l.reason === 'Stock-in from product entry'), `${d.data.length}`);
t.check('newest recorded first', d.data[0].kind === 'count' && d.data.at(-1).reason.startsWith('Invoice stock-in'));
t.check('every line carries its unit', d.data.every(l => l.unit === 'kg'));
t.check('nothing more to load in these dates', d.has_more === false);

t.section('"Stock after" follows the shelf');
const mine = d.data.filter(l => l.inventory_id === cheese.bin).map(l => l.stock_after);
t.check('mozzarella, newest to oldest: 9, 20.3, 20.8, 10.8, 13.2', JSON.stringify(mine) === JSON.stringify([9, 20.3, 20.8, 10.8, 13.2]), JSON.stringify(mine));
t.check('the last one is what is on the shelf now', mine[0] === Number((await call(u, 'GET', `/api/tables/inventory/${cheese.bin}`)).data.quantity));
t.check('each item has its own running figure', d.data.find(l => l.inventory_id === cream.bin).stock_after === 4);
const older = (await log(`?from=${iso(days(60))}`)).data.data;
t.check('going further back keeps the same figures and adds the older line: 3.2',
  older.length === 7 && older.at(-1).stock_after === 3.2 && older.find(l => l.id === d.data[0].id).stock_after === 9);

t.section('one item, a search, a kind');
t.check('one item', (await log(`?inventory_id=${cream.bin}`)).data.data.length === 1);
t.check('a search by name, any capitals', (await log('?q=mozz')).data.data.length === 5 && (await log('?q=CREAM')).data.data.length === 1);
t.check('a search is text, not a pattern', (await log('?q=%25')).data.data.length === 0);
const kinds = Object.fromEntries(await Promise.all(['delivery', 'production', 'waste', 'count', 'sales'].map(async k => [k, (await log(`?kind=${k}`)).data.data.length])));
t.check('deliveries 2, production 2, waste 1, counts 1, sales 0', JSON.stringify(kinds) === JSON.stringify({ delivery: 2, production: 2, waste: 1, count: 1, sales: 0 }), JSON.stringify(kinds));
t.check('a kind the log does not know is ignored, not an error', (await log('?kind=nonsense')).data.data.length === 6);
t.check('filters combine', (await log(`?kind=production&inventory_id=${cheese.bin}`)).data.data.length === 1);
t.check('a filtered line still shows its true "Stock after"', (await log(`?kind=production&inventory_id=${cheese.bin}`)).data.data[0].stock_after === 10.8);

t.section('dates are the server\'s job');
t.check('a window with nothing in it is empty', (await log(`?from=${iso(days(40))}&to=${iso(days(20))}`)).data.data.length === 0);
t.check('an old window finds the old line', (await log(`?from=${iso(days(55))}&to=${iso(days(45))}`)).data.data.length === 1);
t.check('"to" cuts off what came after', (await log(`?to=${iso(days(4.5))}`)).data.data.length === 2);
t.check('a date that is not a date falls back to the default', (await log('?from=yesterday')).data.data.length === 6);

t.section('a line links to where it came from');
const delivery = d.data.find(l => l.kind === 'delivery');
t.check('a delivery names its invoice and carries its id', delivery.invoice_number === `AD-${STAMP}` && delivery.invoice_id === inv, JSON.stringify(delivery));
t.check('a recount line carries its count', d.data[0].stock_take_id === rc.data.stock_take_id && d.data[0].take_kind === 'recount');
await call(u, 'POST', '/api/tables/invoices', { vendor: 'Other Dairy', invoice_number: `AD-${STAMP}`, invoice_date: '2026-10-02', total: 5 });
t.check('two invoices with the same number: no guess, no link', (await log('?kind=delivery')).data.data.every(l => l.invoice_id === ''));

t.section('the log is history');
const lineId = d.data[1].id;
t.check('a line cannot be deleted', (await call(u, 'DELETE', `/api/tables/stock_log/${lineId}`)).status === 409);
t.check('or changed', (await call(u, 'PATCH', `/api/tables/stock_log/${lineId}`, { change: 99 })).status === 409
  && (await call(u, 'PUT', `/api/tables/stock_log/${lineId}`, { change: 99 })).status === 409);
t.check('it is still there, unchanged', (await log()).data.data.find(l => l.id === lineId).change === d.data[1].change);
t.check('removing the item from inventory keeps its lines', (await call(u, 'DELETE', `/api/tables/inventory/${cream.bin}`)).status < 300
  && (await log('?q=cream')).data.data.length === 1);
t.check('with no shelf left, "Stock after" is blank rather than invented', (await log('?q=cream')).data.data[0].stock_after === null);

t.section('nobody else');
t.check('another business sees none of it', (await log('', other)).data.data.length === 0);
t.check('and cannot ask for the item by id', (await log(`?inventory_id=${cheese.bin}`, other)).data.data.length === 0);
t.check('Essential is offered an upgrade', (await log('', essential)).status === 403);
t.check('signed out: refused', (await log('', jar())).status === 401);

t.section('a sale recorded late is taken off when it was recorded, not on the day it is about');
// Sales for five days ago, uploaded now — after the recount that set the shelf to 9.
await move(cheese, -1, 'Sales import', days(5.5));
const late = (await log(`?inventory_id=${cheese.bin}`)).data.data;
t.check('it is at the top: the newest thing recorded', late[0].kind === 'sales' && late[0].change === -1, JSON.stringify(late[0]));
t.check('its "Stock after" is 9 − 1 = 8, the shelf now', late[0].stock_after === 8);
t.check('the recount under it still reads 9, and nothing went negative',
  late[1].stock_after === 9 && late.every(l => l.stock_after >= 0), JSON.stringify(late.map(l => l.stock_after)));
t.check('the Date column still says which day it is about', late[0].moved_at < late[1].moved_at);

t.section('a long log comes in pages');
for (let i = 0; i < 205; i++) {
  await call(u, 'POST', '/api/tables/stock_log', { inventory_id: cheese.bin, item_id: cheese.p, item_type: 'raw_material',
    item_name: 'LG Mozzarella', change: 0, reason: 'Paging filler', moved_at: days(10 + i / 1000) });
}
const p1 = (await log()).data, p2 = (await log('?offset=200')).data;
t.check('200 lines, and more to come', p1.data.length === 200 && p1.has_more === true);
// 205 fillers plus the seven real lines of the last 30 days.
t.check('the next page has the rest: 12', p2.data.length === 12 && p2.has_more === false, `${p2.data.length}`);
t.check('no line twice across the two pages', new Set([...p1.data, ...p2.data].map(l => l.id)).size === 212);

t.done();
