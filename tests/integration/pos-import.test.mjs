// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run dev:sandbox        (in another terminal)
//   node tests/integration/pos-import.test.mjs
//
// Proves the POS sales import moves the right stock and can be undone.
//
// The explosion itself lives in src/index.ts, which the plain-Node runner cannot
// import (no build step for tests; browser-module only reads public/static/*.js).
// Duplicating it under public/ to make it unit-testable would create a fifth
// hand-synced copy of shared logic, so it is covered here instead — through the
// real routes, against a real database.
//
// Self-contained: creates its own business per run, so it can be run repeatedly
// with no cleanup.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from '../helpers/assert.mjs';
import { loadBrowserModule } from '../helpers/browser-module.mjs';

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE  = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);

// ── plumbing (same cookie-jar approach as tenant-isolation) ──────
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
  const cookie = jarHeader(j);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  absorb(j, res);
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

const t = suite('integration/pos-import');

// Skip cleanly when nothing is listening, exactly as the isolation suite does.
try {
  await fetch(`${BASE}/api/auth/me`);
} catch (_) {
  console.log(`\n  no server at ${BASE} — skipping (run: npm run dev:sandbox)\n`);
  process.exit(0);
}

const fixture = join(ROOT, 'tests', 'fixtures', 'square-item-sales-sample.csv');
if (!existsSync(fixture)) {
  console.log('\n  fixture missing — skipping\n');
  process.exit(0);
}

// ── setup ───────────────────────────────────────────────────────
const admin = jar();
const ADMIN = { email: `pos-it-admin-${STAMP}@test.local`, password: 'pos-it-admin-pw-1' };
const boot = await call(admin, 'POST', '/api/auth/bootstrap', { ...ADMIN, name: 'POS IT' });
if (boot.status === 409) {
  const login = await call(admin, 'POST', '/api/auth/login',
    { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
  if (login.status !== 200) {
    console.log('\n  no super-admin session available — skipping\n');
    process.exit(0);
  }
} else if (boot.status === 200) {
  await call(admin, 'POST', '/api/auth/login', ADMIN);
}

const ORG = { name: `POS IT ${STAMP}`, email: `pos-it-${STAMP}@test.local`, password: 'pos-it-password-1' };
const org = await call(admin, 'POST', '/api/admin/organizations',
  { name: ORG.name, owner_email: ORG.email, owner_password: ORG.password, account_type: 'restaurant' });
const orgId = org.data?.organization?.id || org.data?.id;
await call(admin, 'POST', `/api/admin/organizations/${orgId}/plan`, { plan: 'pro' });

const u = jar();
await call(u, 'POST', '/api/auth/login', { email: ORG.email, password: ORG.password });
t.check('business created and signed in', !!u.cookies.dm_session);

// ── seed a pizzeria ─────────────────────────────────────────────
// Sauce is made AHEAD into a batch; the pizza is assembled to order. That split
// is what the double-count guard exists for.
const mkProduct = async (name, qty) => {
  const p = await call(u, 'POST', '/api/tables/generic_products',
    { name, category: 'Other', base_unit: 'kg' });
  await call(u, 'POST', '/api/tables/inventory',
    { item_id: p.data.id, item_type: 'raw_material', item_name: name, category: 'Other', quantity: qty, unit: 'kg' });
  return p.data.id;
};
const flour = await mkProduct('Flour', 100);
const mozz  = await mkProduct('Mozzarella', 20);
const toms  = await mkProduct('Tomatoes', 30);
const salt  = await mkProduct('Salt', 5);

const sauce = await call(u, 'POST', '/api/tables/recipes',
  { name: 'Tomato Sauce', servings: 5, yield_unit: 'kg', total_cost: 0, production_mode: 'batched' });
const sauceId = sauce.data.id;
await call(u, 'POST', '/api/tables/recipe_items',
  { recipe_id: sauceId, product_id: toms, product_name: 'Tomatoes', quantity: 3, unit: 'kg', line_cost: 0 });
await call(u, 'POST', '/api/tables/recipe_items',
  { recipe_id: sauceId, product_id: salt, product_name: 'Salt', quantity: 0.1, unit: 'kg', line_cost: 0 });
await call(u, 'POST', '/api/tables/inventory',
  { item_id: sauceId, item_type: 'batch', item_name: 'Tomato Sauce', category: 'Batch', quantity: 5, unit: 'kg' });

const pizza = await call(u, 'POST', '/api/tables/finished_products',
  { name: 'Margherita Pizza', selling_price: 12, total_cost: 0 });
const pizzaId = pizza.data.id;
const fpItem = (type, ref, name, q) => call(u, 'POST', '/api/tables/finished_product_items',
  { finished_product_id: pizzaId, item_type: type, ref_id: ref, ref_name: name, quantity: q, unit: 'kg', line_cost: 0 });
await fpItem('product', flour, 'Flour', 0.25);
await fpItem('product', mozz,  'Mozzarella', 0.15);
await fpItem('recipe',  sauceId, 'Tomato Sauce', 0.1);
t.check('kitchen seeded', !!pizzaId && !!sauceId);

const qtyOf = async (name) => {
  const inv = await call(u, 'GET', '/api/tables/inventory?page=1&limit=100');
  const row = (inv.data?.data || []).find(r => r.item_name === name);
  return row ? Number(row.quantity) : null;
};

// ── import ──────────────────────────────────────────────────────
const { parsePosCsv } = loadBrowserModule(['pos-parse.js'], ['parsePosCsv'], { window: {} });
const parsed = parsePosCsv(readFileSync(fixture, 'utf8'), 'square.csv');
t.check('fixture parses to 5/2/1', parsed.ok
  && parsed.items.find(i => i.pos_item_name === 'Margherita Pizza').qty === 5
  && parsed.items.find(i => i.pos_item_name === 'Hawaii Pizza').qty === 2
  && parsed.items.find(i => i.pos_item_name === 'Prosciutto Pizza').qty === 1);

const draft = await call(u, 'POST', '/api/pos-imports', { parsed, content_hash: 'it-' + STAMP });
t.check('draft created', draft.status === 200, `${draft.status}`);
const importId = draft.data.import_id;

const margherita = draft.data.items.find(i => i.pos_item_name === 'Margherita Pizza');
t.check('Margherita matched the finished product by name',
  margherita?.target_type === 'finished_product' && margherita?.target_id === pizzaId,
  JSON.stringify({ type: margherita?.target_type, src: margherita?.match_source }));

const commit = await call(u, 'POST', `/api/pos-imports/${importId}/commit`,
  { items: draft.data.items, deplete: true });
t.check('commit succeeded', commit.status === 200, `${commit.status} ${JSON.stringify(commit.data?.error)}`);
t.check('7 sale lines written', commit.data.lines_written === 7, `${commit.data.lines_written}`);
t.check('no duplicates on a first import', commit.data.skipped_duplicates === 0);

// ── the stock ───────────────────────────────────────────────────
t.section('stock moved — and the double-count guard held');
t.check('flour 100 -> 98.75',        t.near(await qtyOf('Flour'), 98.75),      `${await qtyOf('Flour')}`);
t.check('mozzarella 20 -> 19.25',    t.near(await qtyOf('Mozzarella'), 19.25), `${await qtyOf('Mozzarella')}`);
t.check('sauce batch 5 -> 4.5',      t.near(await qtyOf('Tomato Sauce'), 4.5), `${await qtyOf('Tomato Sauce')}`);
t.check('TOMATOES still 30',         t.near(await qtyOf('Tomatoes'), 30),      `${await qtyOf('Tomatoes')}`);
t.check('SALT still 5',              t.near(await qtyOf('Salt'), 5),           `${await qtyOf('Salt')}`);

const log = await call(u, 'GET', '/api/tables/stock_log?page=1&limit=200');
const posLog = (log.data?.data || []).filter(r => r.pos_import_id === importId);
t.check('12 movements logged (3 ingredients x 4 selling days)', posLog.length === 12, `${posLog.length}`);
t.check('every movement is coded as kitchen usage',
  posLog.every(r => r.reason_code === 'usage'),
  JSON.stringify([...new Set(posLog.map(r => r.reason_code))]));
t.check('flour moved on 4 distinct days',
  new Set(posLog.filter(r => r.item_name === 'Flour').map(r => r.moved_at.slice(0, 10))).size === 4);

// ── idempotency ─────────────────────────────────────────────────
t.section('the same sales cannot land twice');
const dupFile = await call(u, 'POST', '/api/pos-imports', { parsed, content_hash: 'it-' + STAMP });
t.check('identical file is refused', dupFile.status === 409 && dupFile.data.duplicate === true, `${dupFile.status}`);

// Force past the file guard, then commit: every line's external_ref is already
// committed, so every line must be skipped and no stock may move.
const forced = await call(u, 'POST', '/api/pos-imports',
  { parsed, content_hash: 'it-' + STAMP, force: true });
const forcedCommit = await call(u, 'POST', `/api/pos-imports/${forced.data.import_id}/commit`,
  { items: forced.data.items, deplete: true });
t.check('re-committing the same lines writes nothing',
  forcedCommit.data.lines_written === 0, `${forcedCommit.data.lines_written}`);
t.check('and reports them as already imported',
  forcedCommit.data.skipped_duplicates === 7, `${forcedCommit.data.skipped_duplicates}`);
t.check('stock did NOT move a second time', t.near(await qtyOf('Flour'), 98.75), `${await qtyOf('Flour')}`);

// A partly-overlapping export: same week plus one new sale.
const overlap = JSON.parse(JSON.stringify(parsed));
overlap.lines.push({
  ...overlap.lines[0], external_ref: 'NEW-' + STAMP, sold_date: '2026-07-27', qty: 1,
  gross_sales: 12, discounts: 0, net_sales: 12, tax: 1.02,
});
const overlapDraft = await call(u, 'POST', '/api/pos-imports',
  { parsed: overlap, content_hash: 'overlap-' + STAMP });
const overlapCommit = await call(u, 'POST', `/api/pos-imports/${overlapDraft.data.import_id}/commit`,
  { items: overlapDraft.data.items, deplete: true });
t.check('an overlapping export commits only the new line',
  overlapCommit.data.lines_written === 1 && overlapCommit.data.skipped_duplicates === 7,
  `written=${overlapCommit.data.lines_written} skipped=${overlapCommit.data.skipped_duplicates}`);
t.check('and moves stock only for that one sale',
  t.near(await qtyOf('Flour'), 98.5), `${await qtyOf('Flour')}`);

// ── void and restore ────────────────────────────────────────────
t.section('void puts the stock back');
const voided = await call(u, 'POST', `/api/pos-imports/${importId}/void`, { reason: 'test' });
t.check('void succeeded', voided.status === 200, `${voided.status}`);
t.check('12 movements reversed', voided.data.movements_reversed === 12, `${voided.data.movements_reversed}`);
t.check('flour back to 99.75 (the overlap import still stands)',
  t.near(await qtyOf('Flour'), 99.75), `${await qtyOf('Flour')}`);
// 5 - 0.5 (first import) - 0.1 (overlap import) + 0.5 (this void) = 4.9.
// The overlap import is NOT voided, so its 0.1 stays off.
t.check('sauce batch back to 4.9', t.near(await qtyOf('Tomato Sauce'), 4.9), `${await qtyOf('Tomato Sauce')}`);
t.check('voiding twice is refused',
  (await call(u, 'POST', `/api/pos-imports/${importId}/void`, {})).status === 409);

const restored = await call(u, 'POST', `/api/pos-imports/${importId}/restore`, {});
t.check('restore succeeded', restored.status === 200, `${restored.status}`);
t.check('flour back down to 98.5', t.near(await qtyOf('Flour'), 98.5), `${await qtyOf('Flour')}`);
t.check('sauce back down to 4.4', t.near(await qtyOf('Tomato Sauce'), 4.4), `${await qtyOf('Tomato Sauce')}`);
t.check('quantities are stored clean, not 4.3999999999999995',
  String(await qtyOf('Tomato Sauce')).length <= 6, `${await qtyOf('Tomato Sauce')}`);

// ── the mapping is remembered ───────────────────────────────────
t.section('the second upload routes itself');
const second = JSON.parse(JSON.stringify(parsed));
for (const l of second.lines) l.external_ref = 'S2-' + l.external_ref;
const secondDraft = await call(u, 'POST', '/api/pos-imports',
  { parsed: second, content_hash: 'second-' + STAMP });
const m2 = secondDraft.data.items.find(i => i.pos_item_name === 'Margherita Pizza');
t.check('Margherita is remembered from last time',
  m2?.match_source === 'remembered' && m2?.target_id === pizzaId,
  JSON.stringify({ src: m2?.match_source, id: m2?.target_id }));

// ── P&L revenue ─────────────────────────────────────────────────
t.section('imported sales become P&L revenue');
const pnl = await call(u, 'GET', '/api/pnl?from=2026-07&to=2026-07');
t.check('P&L reports the imported month', !!pnl.data?.sales?.by_month?.['2026-07'],
  JSON.stringify(pnl.data?.sales));

// The first import (7 lines, $103) was voided then restored, and the overlap
// import added one more $12 sale — so July is $115 across 8 lines.
const july = pnl.data.sales.by_month['2026-07'];
t.check('net is the sum of both live imports', t.near(july.imported_net, 115), `${july.imported_net}`);
t.check('8 sale lines counted', july.lines === 8, `${july.lines}`);
t.check('uncategorised sales fall to food, not beverage',
  t.near(july.beverage, 0) && t.near(july.food, 115), `food=${july.food} bev=${july.beverage}`);

// Revenue is DERIVED — voiding an import must remove it without anything being
// rewritten in sales_monthly.
await call(u, 'POST', `/api/pos-imports/${importId}/void`, { reason: 'revenue check' });
const pnlVoided = await call(u, 'GET', '/api/pnl?from=2026-07&to=2026-07');
t.check('voiding drops that import out of revenue',
  t.near(pnlVoided.data.sales.by_month['2026-07']?.imported_net ?? 0, 12),
  `${pnlVoided.data.sales.by_month['2026-07']?.imported_net}`);
t.check('and nothing was written to sales_monthly',
  ((await call(u, 'GET', '/api/tables/sales_monthly?page=1&limit=50')).data?.data || []).length === 0);
await call(u, 'POST', `/api/pos-imports/${importId}/restore`, {});

// A draft that was never committed must not count as revenue.
const ghost = await call(u, 'POST', '/api/pos-imports',
  { parsed, content_hash: 'ghost-' + STAMP, force: true });
const pnlGhost = await call(u, 'GET', '/api/pnl?from=2026-07&to=2026-07');
t.check('an uncommitted draft contributes nothing',
  t.near(pnlGhost.data.sales.by_month['2026-07'].imported_net, 115),
  `${pnlGhost.data.sales.by_month['2026-07'].imported_net}`);
await call(u, 'DELETE', `/api/pos-imports/${ghost.data.import_id}`);

// ── isolation ───────────────────────────────────────────────────
t.section('another business cannot touch it');
const other = { name: `POS IT B ${STAMP}`, email: `pos-it-b-${STAMP}@test.local`, password: 'pos-it-b-password-1' };
const otherOrg = await call(admin, 'POST', '/api/admin/organizations',
  { name: other.name, owner_email: other.email, owner_password: other.password, account_type: 'restaurant' });
await call(admin, 'POST',
  `/api/admin/organizations/${otherOrg.data?.organization?.id || otherOrg.data?.id}/plan`, { plan: 'pro' });
const b = jar();
await call(b, 'POST', '/api/auth/login', { email: other.email, password: other.password });
t.check('cannot read it',    (await call(b, 'GET',  `/api/pos-imports/${importId}`)).status === 404);
t.check('cannot commit it',  (await call(b, 'POST', `/api/pos-imports/${importId}/commit`, {})).status === 404);
t.check('cannot void it',    (await call(b, 'POST', `/api/pos-imports/${importId}/void`, {})).status === 404);
t.check('cannot preview it', (await call(b, 'POST', `/api/pos-imports/${importId}/preview`, {})).status === 404);

t.done();
