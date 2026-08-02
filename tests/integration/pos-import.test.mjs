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

// ── recipes are not a link target ────────────────────────────────
// The picker only offers finished products, but the review screen posts its
// mapping decisions back, so the server has to hold this on its own. A forged
// recipe target must be scrubbed to unmapped rather than deducting the recipe's
// batch bin. Uses /preview, which writes nothing, so the P&L numbers below stay
// exactly as the commits above left them.
t.section('a sale can only point at a finished product');
const previewOf = (items) => call(u, 'POST',
  `/api/pos-imports/${secondDraft.data.import_id}/preview`, { items });

const basePreview = await previewOf(secondDraft.data.items);
const sauceMoved = (p) => (p.data.movements || [])
  .some(m => m.item_type === 'batch' && m.item_id === sauceId);
t.check('baseline: the finished product does deduct the sauce batch',
  basePreview.status === 200 && sauceMoved(basePreview), `${basePreview.status}`);

const forged = JSON.parse(JSON.stringify(secondDraft.data.items));
for (const it of forged) {
  if (it.pos_item_name !== 'Margherita Pizza') continue;
  it.target_type = 'recipe'; it.target_id = sauceId;
  it.target_name = 'Tomato Sauce'; it.qty_per_sale = 1; it.target_unit = 'kg';
}
const forgedPreview = await previewOf(forged);
t.check('a forged recipe target deducts nothing',
  forgedPreview.status === 200 && !sauceMoved(forgedPreview),
  JSON.stringify((forgedPreview.data.movements || []).map(m => `${m.item_type}:${m.item_name}`)));
t.check('and the line is counted as unmapped instead',
  forgedPreview.data.unmapped_lines > basePreview.data.unmapped_lines,
  `base=${basePreview.data.unmapped_lines} forged=${forgedPreview.data.unmapped_lines}`);

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

// ── the tub runs dry ────────────────────────────────────────────
// Produce Batch is optional, not mandatory. A sale takes prep from the batch
// bin if the bin has it, and takes the raw ingredients underneath when it does
// not — because an empty bin means that production was never declared, so those
// ingredients never came off the shelf and have to come off now.
//
// Uses /preview throughout, which writes nothing, so the stock and P&L figures
// asserted above stay exactly as the commits left them.
t.section('an empty batch bin falls through to raw ingredients');

const basil = await mkProduct('Basil', 10);
const pesto = await call(u, 'POST', '/api/tables/recipes',
  { name: 'Pesto', servings: 6, yield_unit: 'kg', total_cost: 0, production_mode: 'batched' });
const pestoId = pesto.data.id;
// 6 kg of pesto from 12 kg of basil, so 1 kg of pesto is worth 2 kg of basil.
await call(u, 'POST', '/api/tables/recipe_items',
  { recipe_id: pestoId, product_id: basil, product_name: 'Basil', quantity: 12, unit: 'kg', line_cost: 0 });
// Deliberately NO inventory row: nobody ever pressed Produce Batch.

const pasta = await call(u, 'POST', '/api/tables/finished_products',
  { name: 'Pesto Pasta', selling_price: 14, total_cost: 0 });
const pastaId = pasta.data.id;
await call(u, 'POST', '/api/tables/finished_product_items',
  { finished_product_id: pastaId, item_type: 'recipe', ref_id: pestoId,
    ref_name: 'Pesto', quantity: 0.2, unit: 'kg', line_cost: 0 });

// 5 days x 2 plates x 0.2 kg = 2 kg of pesto, i.e. 4 kg of basil.
const pestoKey = 'pesto pasta|';
const pestoParsed = {
  ...JSON.parse(JSON.stringify(parsed)),
  items: [{ ...parsed.items[0], pos_item_key: pestoKey, pos_item_name: 'Pesto Pasta', price_point: '', qty: 10 }],
  lines: [],
};
for (let i = 0; i < 5; i++) {
  pestoParsed.lines.push({
    ...parsed.lines[0],
    pos_item_key: pestoKey, pos_item_name: 'Pesto Pasta',
    external_ref: `PESTO-${STAMP}-${i}`, sold_date: `2026-07-2${i + 1}`,
    qty: 2, gross_sales: 28, discounts: 0, net_sales: 28, tax: 0,
  });
}

const pestoDraft = await call(u, 'POST', '/api/pos-imports',
  { parsed: pestoParsed, content_hash: 'pesto-' + STAMP });
t.check('pesto draft created and matched', pestoDraft.status === 200
  && pestoDraft.data.items[0]?.target_id === pastaId,
  `${pestoDraft.status} ${pestoDraft.data.items?.[0]?.target_id}`);

const pestoPreview = (items) => call(u, 'POST',
  `/api/pos-imports/${pestoDraft.data.import_id}/preview`, { items });
const totalFor = (p, type, id) => (p.data.movements || [])
  .filter(m => m.item_type === type && m.item_id === id)
  .reduce((s, m) => s + Number(m.qty), 0);

const dry = await pestoPreview(pestoDraft.data.items);
t.check('with no batch bin, the basil comes off instead',
  t.near(totalFor(dry, 'raw_material', basil), 4), `${totalFor(dry, 'raw_material', basil)}`);
t.check('and nothing is deducted from a bin that does not exist',
  t.near(totalFor(dry, 'batch', pestoId), 0), `${totalFor(dry, 'batch', pestoId)}`);
t.check('the fall-through is reported, not silent',
  (dry.data.fell_through || []).some(f => f.item_name === 'Pesto' && t.near(f.from_raw, 2)),
  JSON.stringify(dry.data.fell_through));

// Now give it a tub holding less than the week needs. 1.2 kg of the 2 kg comes
// out of the tub; the remaining 0.8 kg is worth 1.6 kg of basil.
await call(u, 'POST', '/api/tables/inventory',
  { item_id: pestoId, item_type: 'batch', item_name: 'Pesto', category: 'Batch', quantity: 1.2, unit: 'kg' });

const partial = await pestoPreview(pestoDraft.data.items);
t.check('a partly-stocked tub gives up exactly what it holds',
  t.near(totalFor(partial, 'batch', pestoId), 1.2), `${totalFor(partial, 'batch', pestoId)}`);
t.check('and only the shortfall reaches the basil',
  t.near(totalFor(partial, 'raw_material', basil), 1.6), `${totalFor(partial, 'raw_material', basil)}`);
t.check('the split is reported with both halves',
  (partial.data.fell_through || []).some(f =>
    f.item_name === 'Pesto' && t.near(f.from_bin, 1.2) && t.near(f.from_raw, 0.8)),
  JSON.stringify(partial.data.fell_through));

// The regression this guards: five sale lines each reading the same opening
// balance would take 0.4 kg five times over from a tub holding 1.2 kg. The
// balance has to run down across the import, not reset per line.
t.check('the bin is spent down across lines, not re-read per line',
  totalFor(partial, 'batch', pestoId) < 2, `${totalFor(partial, 'batch', pestoId)}`);

// A tub with more than enough must behave exactly as it always did — bin only,
// no raw materials, nothing reported.
const pestoBin = (await call(u, 'GET', '/api/tables/inventory?page=1&limit=200'))
  .data.data.find(r => r.item_id === pestoId && r.item_type === 'batch');
await call(u, 'PATCH', `/api/tables/inventory/${pestoBin.id}`, { quantity: 50 });

const covered = await pestoPreview(pestoDraft.data.items);
t.check('a full tub covers the lot, as before this change',
  t.near(totalFor(covered, 'batch', pestoId), 2), `${totalFor(covered, 'batch', pestoId)}`);
t.check('and the basil is not touched at all',
  t.near(totalFor(covered, 'raw_material', basil), 0), `${totalFor(covered, 'raw_material', basil)}`);
t.check('with nothing reported, because nothing fell through',
  (covered.data.fell_through || []).length === 0, JSON.stringify(covered.data.fell_through));

// Why the auto-flip in confirmProduceBatch has to exist. A recipe left on
// 'on_demand' explodes straight to raw materials and never looks at the bin —
// correct on its own, but if someone produced a batch anyway, those same
// ingredients already came off when the batch was made. The bin then sits
// untouched forever while the ingredients are charged twice. Pressing Produce
// Batch now sets the recipe to 'batched', which is what stops this arising.
await call(u, 'PATCH', `/api/tables/recipes/${pestoId}`, { production_mode: 'on_demand' });
const onDemand = await pestoPreview(pestoDraft.data.items);
t.check('on_demand ignores a stocked bin entirely — the reason the flip exists',
  t.near(totalFor(onDemand, 'batch', pestoId), 0)
  && t.near(totalFor(onDemand, 'raw_material', basil), 4),
  `bin=${totalFor(onDemand, 'batch', pestoId)} basil=${totalFor(onDemand, 'raw_material', basil)}`);

await call(u, 'DELETE', `/api/pos-imports/${pestoDraft.data.import_id}`);

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
