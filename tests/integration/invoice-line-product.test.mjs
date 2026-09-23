// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run db:migrate:local   (for 0054)
//   npm run dev:sandbox        (in another terminal)
//   npm run test:line-product
//
// Invoice lines are tied to their product by ID (migration 0054), end to end.
//
// The bug this guards: YEN BROS invoice lines "Fingerling" and "Milk" were
// filed (through a supplier alias) under "Yellow Fingerling Potato" and
// "Homogenized Milk". The reports matched lines to products by NAME, found
// nothing, and put the spend under "Uncategorized". This file walks the same
// shape through the real routes — save, import, edit, rename, re-categorise,
// merge, group — and checks the DATABASE and both reports after each step.
import { suite } from '../helpers/assert.mjs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);
const ADMIN = { email: `lp-admin-${STAMP}@test.local`, password: 'lp-admin-pw-1' };

function jar() { return { cookies: {} }; }
function jarHeader(j) {
  const pairs = Object.entries(j?.cookies || {}).filter(([, v]) => v !== '');
  return pairs.length ? pairs.map(([k, v]) => `${k}=${v}`).join('; ') : '';
}
function absorbCookies(j, res) {
  if (!j) return;
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of raw) {
    const [pair] = String(line).split(';');
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    j.cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
}
async function call(j, method, path, body) {
  const cookie = jarHeader(j);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  absorbCookies(j, res);
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}
const get  = (j, p)    => call(j, 'GET', p);
const post = (j, p, b) => call(j, 'POST', p, b);
const put  = (j, p, b) => call(j, 'PUT', p, b);

const t = suite('integration/invoice-line-product');

// ── Setup: two throwaway organizations of our own ────────────────
const admin = jar();
const boot = await post(admin, '/api/auth/bootstrap', { ...ADMIN, name: 'Line Product Test' });
if (boot.status === 409) {
  const login = await post(admin, '/api/auth/login', {
    email: 'simoneisonni@gmail.com', password: 'correct-horse-battery',
  });
  if (login.status !== 200) {
    console.error('\n  Cannot get a super-admin session. Start from a fresh local database.\n');
    process.exit(1);
  }
} else if (boot.status === 200) {
  await post(admin, '/api/auth/login', ADMIN);
}

async function mkOrg(tag) {
  const o = {
    name: `LineProduct ${tag} ${STAMP}`,
    email: `lp-${tag}-${STAMP}@test.local`,
    password: 'lp-owner-pw-1',
  };
  const created = await post(admin, '/api/admin/organizations', {
    name: o.name, owner_email: o.email, owner_password: o.password, account_type: 'restaurant',
  });
  t.check(`test restaurant ${tag} created`, created.status === 200, JSON.stringify(created.data));
  const j = jar();
  await post(j, '/api/auth/login', { email: o.email, password: o.password });
  return j;
}
const own   = await mkOrg('a');
const other = await mkOrg('b');

const rows = async (j, table, qs = '') =>
  (await get(j, `/api/tables/${table}?page=1&limit=500${qs}`)).data?.data || [];
async function mkProduct(j, name, category) {
  const r = await post(j, '/api/tables/generic_products', { name, category, base_unit: 'kg' });
  return r.data?.data?.id || r.data?.id;
}
const breakdown = async () =>
  (await get(own, '/api/spending-breakdown?from=2026-05-01&to=2026-05-31')).data;
const catAmount = (b, cat) => (b?.by_category || []).find(r => r.category === cat)?.amount ?? 0;
const pnl = async () => (await get(own, '/api/pnl?from=2026-05&to=2026-05')).data;

// ── Fixture: the real case ───────────────────────────────────────
const potatoId = await mkProduct(own, 'Yellow Fingerling Potato', 'Produce');
const milkId   = await mkProduct(own, 'Homogenized Milk',         'Dairy & Eggs');
t.check('products created', !!potatoId && !!milkId);
// The supplier's wording routes to the product through an alias — the exact
// step where the invoice line's name and the product's name part ways.
await post(own, '/api/tables/product_aliases', { alias_name: 'Fingerling', generic_product_id: potatoId });
await post(own, '/api/tables/product_aliases', { alias_name: 'Milk',       generic_product_id: milkId });
// A product in ANOTHER business, used to prove its id can't be attached here.
const foreignId = await mkProduct(other, 'Foreign Basil', 'Produce');

const inv = await post(own, '/api/tables/invoices', {
  vendor: 'Yen Test', invoice_number: `YEN-${STAMP}`, invoice_date: '2026-05-08',
  status: 'Closed', total: 31.25,
});
const invId = inv.data?.data?.id || inv.data?.id;
t.check('invoice created', !!invId, JSON.stringify(inv.data));

// Exactly what Confirm & Save sends: lines first (vendor wording), ids back.
const lines = [
  { product_name: 'Fingerling', packaging: '5 lb', price: 20.22, qty: 1, line_total: 20.22 },
  { product_name: 'Milk',       packaging: '4 L',  price: 11.03, qty: 1, line_total: 11.03 },
];
const replaced = await post(own, `/api/invoice-lines/${invId}/replace`, { lines });
t.check('replace returns one new line id per line, in order',
  replaced.status === 200 && replaced.data?.line_ids?.length === 2, JSON.stringify(replaced.data));
const lineIds = replaced.data?.line_ids || [];

const bulk = await post(own, '/api/bulk/upsert-products', {
  vendor_name: 'Yen Test',
  products: lines.map((l, i) => ({
    name: l.product_name, pack_size: l.packaging, qty: l.qty, unit_price: l.price,
    cost: l.line_total, invoice_ref: `YEN-${STAMP}`, invoice_id: invId,
    invoice_date: '2026-05-08', invoice_line_id: lineIds[i],
  })),
});
t.check('import succeeds and reuses both products via their aliases',
  bulk.status === 200 && bulk.data?.reused_generics === 2 && bulk.data?.created_generics === 0,
  JSON.stringify(bulk.data));

const linesOf = async () => (await rows(own, 'invoice_lines', `&invoice_id=${invId}`))
  .sort((a, b) => a.line_total - b.line_total);
let saved = await linesOf();
t.check('the lines keep the invoice wording', saved.map(l => l.product_name).join('|') === 'Milk|Fingerling',
  JSON.stringify(saved.map(l => l.product_name)));
t.check('…and now point at the products the purchases were filed under',
  saved[0]?.generic_product_id === milkId && saved[1]?.generic_product_id === potatoId,
  JSON.stringify(saved.map(l => l.generic_product_id)));

let b = await breakdown();
t.check('spending breakdown: nothing Uncategorized (was $31.25 by name match)',
  catAmount(b, 'Uncategorized') === 0, JSON.stringify(b?.by_category));
t.check('spending breakdown: Fingerling counts as Produce', catAmount(b, 'Produce') === 20.22, JSON.stringify(b?.by_category));
t.check('spending breakdown: Milk counts as Dairy & Eggs', catAmount(b, 'Dairy & Eggs') === 11.03, JSON.stringify(b?.by_category));
let p = await pnl();
t.check('P&L: none of it is reported as uncategorised food', p?.food_uncategorized === 0, JSON.stringify(p));
t.check('P&L: food cost is the full $31.25', p?.food_cost === 31.25, `food_cost=${p?.food_cost}`);

// ── Editing a saved invoice must not unlink it ───────────────────
// saveInvDetail sends every line back with its id; the route re-inserts them.
const edited = saved.map(l => ({ ...l, qty: l.qty, price: l.price, line_total: l.line_total }));
edited[1] = { ...edited[1], product_name: 'Fingerling (edited)' };
await post(own, `/api/invoice-lines/${invId}/replace`, { lines: edited });
saved = await linesOf();
t.check('after an edit + save, both lines are still linked',
  saved[0]?.generic_product_id === milkId && saved[1]?.generic_product_id === potatoId,
  JSON.stringify(saved.map(l => [l.product_name, l.generic_product_id])));
t.check('…even the line whose name was edited to match nothing',
  saved[1]?.product_name === 'Fingerling (edited)' && catAmount(await breakdown(), 'Uncategorized') === 0);

// ── A product id from another business is never attached ─────────
const withForeign = saved.map(l => ({ ...l }));
withForeign[0] = { ...withForeign[0], generic_product_id: foreignId };
withForeign[1] = { ...withForeign[1], generic_product_id: 'no-such-product' };
await post(own, `/api/invoice-lines/${invId}/replace`, { lines: withForeign });
saved = await linesOf();
t.check('another business\'s product id is dropped (stored as none)',
  !saved[0]?.generic_product_id, JSON.stringify(saved.map(l => l.generic_product_id)));
t.check('an unknown product id is dropped too', !saved[1]?.generic_product_id);
// put them back for the rest of the run
saved[0].generic_product_id = milkId;
saved[1].generic_product_id = potatoId;
await post(own, `/api/invoice-lines/${invId}/replace`, { lines: saved });
saved = await linesOf();
t.check('links restored for the remaining steps',
  saved[0]?.generic_product_id === milkId && saved[1]?.generic_product_id === potatoId);

// ── Rename: nothing to cascade, the id still holds ───────────────
const ren = await put(own, `/api/generic_products/${potatoId}`, { name: `Gold Fingerlings ${STAMP}`, category: 'Produce' });
t.check('rename accepted', ren.status === 200, JSON.stringify(ren.data));
b = await breakdown();
t.check('after a rename: still nothing Uncategorized', catAmount(b, 'Uncategorized') === 0, JSON.stringify(b?.by_category));
t.check('after a rename: still Produce', catAmount(b, 'Produce') === 20.22);

// ── Category change follows the product, past invoices included ──
await put(own, `/api/generic_products/${potatoId}`, { name: `Gold Fingerlings ${STAMP}`, category: 'Dry Goods & Pantry' });
b = await breakdown();
t.check('a category change moves the line\'s spend with it',
  catAmount(b, 'Dry Goods & Pantry') === 20.22 && catAmount(b, 'Produce') === 0, JSON.stringify(b?.by_category));

// ── Merge: the line follows the surviving product ────────────────
const wholeMilkId = await mkProduct(own, 'Whole Milk 3.25%', 'Dairy & Eggs');
const merge = await post(own, '/api/products/merge', { merged_id: milkId, surviving_id: wholeMilkId });
t.check('merge succeeds', merge.status === 200, JSON.stringify(merge.data));
saved = await linesOf();
t.check('after a merge the line points at the surviving product',
  saved[0]?.generic_product_id === wholeMilkId, JSON.stringify(saved.map(l => l.generic_product_id)));
b = await breakdown();
t.check('after a merge: still nothing Uncategorized', catAmount(b, 'Uncategorized') === 0, JSON.stringify(b?.by_category));

// ── Group: the line follows the umbrella product ─────────────────
const oatId = await mkProduct(own, 'Oat Milk Barista', 'Dairy & Eggs');
const group = await post(own, '/api/products/group', {
  general_name: `Milk ${STAMP}`, product_ids: [oatId, wholeMilkId],
});
t.check('group succeeds', group.status === 200, JSON.stringify(group.data));
saved = await linesOf();
t.check('after a group the line points at the umbrella product',
  saved[0]?.generic_product_id === group.data?.survivor_id, JSON.stringify(saved.map(l => l.generic_product_id)));
b = await breakdown();
t.check('after a group: still nothing Uncategorized, Milk still Dairy & Eggs',
  catAmount(b, 'Uncategorized') === 0 && catAmount(b, 'Dairy & Eggs') === 11.03, JSON.stringify(b?.by_category));

// ── A line with no id still falls back to the old name match ─────
// (A product nothing above has renamed — Group renames its survivor.)
await mkProduct(own, 'Heavy Cream 36%', 'Dairy & Eggs');
const inv2 = await post(own, '/api/tables/invoices', {
  vendor: 'Yen Test', invoice_number: `YEN2-${STAMP}`, invoice_date: '2026-05-09', status: 'Closed', total: 5,
});
const inv2Id = inv2.data?.data?.id || inv2.data?.id;
await post(own, `/api/invoice-lines/${inv2Id}/replace`, {
  lines: [{ product_name: 'Heavy Cream 36%', price: 5, qty: 1, line_total: 5 }],
});
b = await breakdown();
t.check('an unlinked line whose name matches a product still categorises by name',
  catAmount(b, 'Dairy & Eggs') === 16.03 && catAmount(b, 'Uncategorized') === 0, JSON.stringify(b?.by_category));

t.done();
