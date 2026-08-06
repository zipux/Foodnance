// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run dev:sandbox        (in another terminal)
//   npm run test:merge
//
// Merge and Group, end to end against a real database.
//
// These two were broken for every account from 2026-07-23 to 2026-08-06: the
// name cascade wrote `invoice_lines.generic_product_id`, a column that has
// never existed in any migration, so the request 500'd. Because the steps ran
// as separate statements rather than one transaction, the earlier ones had
// already committed — purchase history moved to the survivor while the absorbed
// product stayed live and empty, and Group never reached the alias that is the
// entire point of grouping.
//
// A unit test cannot catch that class of bug: the column name is a string
// inside SQL and only a real database objects to it. So this file exercises the
// live routes and then checks the DATABASE, not the response — every table the
// cascade touches, including the ones whose absence was invisible before.
import { suite } from '../helpers/assert.mjs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);
const ADMIN = { email: `merge-admin-${STAMP}@test.local`, password: 'merge-admin-pw-1' };

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

const t = suite('integration/product-merge');

// ── Setup: a throwaway organization of our own ───────────────────
const admin = jar();
const boot = await post(admin, '/api/auth/bootstrap', { ...ADMIN, name: 'Merge Test' });
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

const ORG = {
  name: `Merge ${STAMP}`,
  email: `merge-owner-${STAMP}@test.local`,
  password: 'merge-owner-pw-1',
};
const created = await post(admin, '/api/admin/organizations', {
  name: ORG.name, owner_email: ORG.email, owner_password: ORG.password, account_type: 'restaurant',
});
t.check('test restaurant created', created.status === 200, JSON.stringify(created.data));

const own = jar();
await post(own, '/api/auth/login', { email: ORG.email, password: ORG.password });

// Helpers that read back what the routes actually wrote.
const rows = async (table, qs = '') => (await get(own, `/api/tables/${table}?page=1&limit=200${qs}`)).data?.data || [];
async function mkProduct(name, unit = 'kg') {
  const r = await post(own, '/api/tables/generic_products', { name, base_unit: unit, category: 'Dry Goods' });
  return r.data?.data?.id || r.data?.id;
}
async function mkEntry(productId, productName, supplier, cost) {
  await post(own, '/api/tables/product_entries', {
    generic_product_id: productId, generic_product_name: productName,
    supplier_name: supplier, pack_qty: 1, pack_unit: 'kg', cost,
    cost_per_unit: cost, qty_ordered: 1, purchase_date: '2026-08-01',
  });
}
async function mkInventory(productId, productName, qty) {
  await post(own, '/api/tables/inventory', {
    item_id: productId, item_type: 'raw_material', item_name: productName,
    quantity: qty, unit: 'kg',
  });
}

// ── Merge: an accidental duplicate folded into the real product ──
// Both sides carry every kind of row the cascade has to move, so a statement
// that silently matches nothing shows up as a failed assertion below.
const dupId  = await mkProduct('Tomatoes Tinned');
const realId = await mkProduct('Tinned Tomatoes');
t.check('two products created', !!dupId && !!realId, `${dupId} / ${realId}`);

await mkEntry(dupId,  'Tomatoes Tinned', 'Sacco Foods',   12.50);
await mkEntry(realId, 'Tinned Tomatoes', 'Molino Rossi',  11.80);
await mkInventory(dupId,  'Tomatoes Tinned', 4);
await mkInventory(realId, 'Tinned Tomatoes', 6);

const recipe = await post(own, '/api/tables/recipes', { name: `Sugo ${STAMP}`, servings: 1, yield_unit: 'L' });
const recipeId = recipe.data?.data?.id || recipe.data?.id;
const riMade = await post(own, '/api/tables/recipe_items', {
  recipe_id: recipeId, product_id: dupId, product_name: 'Tomatoes Tinned', quantity: 500, unit: 'g',
});
t.check('fixture: recipe line created', riMade.status === 200 || riMade.status === 201,
  `status ${riMade.status} · recipe ${recipeId}`);

const inv = await post(own, '/api/tables/invoices', {
  vendor: 'Sacco Foods', invoice_number: `INV-${STAMP}`, invoice_date: '2026-08-01', total: 12.50,
});
const invId = inv.data?.data?.id || inv.data?.id;
const lineMade = await post(own, '/api/tables/invoice_lines', {
  invoice_id: invId, product_name: 'Tomatoes Tinned', qty: 1, price: 12.50, line_total: 12.50,
});
t.check('fixture: invoice line created', lineMade.status === 200 || lineMade.status === 201,
  `status ${lineMade.status} · invoice ${invId}`);

const merge = await post(own, '/api/products/merge', { merged_id: dupId, surviving_id: realId });
t.check('merge returns 200 (it used to 500 on a column that does not exist)',
  merge.status === 200, `status ${merge.status} · ${JSON.stringify(merge.data)}`);

// The response is not the proof — the database is.
const gpAfter   = await rows('generic_products');
const dupAfter  = gpAfter.find(p => p.id === dupId);
const realAfter = gpAfter.find(p => p.id === realId);
t.check('the absorbed product is archived (the step that never ran before)',
  !!dupAfter?.deleted_at, `deleted_at=${dupAfter?.deleted_at}`);
t.check('the surviving product is still live', !!realAfter && !realAfter.deleted_at);

const entriesAfter = await rows('product_entries');
t.check('both purchase histories now point at the survivor',
  entriesAfter.filter(e => e.generic_product_id === realId).length === 2 &&
  entriesAfter.filter(e => e.generic_product_id === dupId).length === 0,
  JSON.stringify(entriesAfter.map(e => [e.generic_product_name, e.generic_product_id])));
t.check('and carry the surviving name',
  entriesAfter.filter(e => e.generic_product_id === realId)
    .every(e => e.generic_product_name === 'Tinned Tomatoes'));

const invAfter = (await rows('inventory')).filter(r => r.item_id === realId || r.item_id === dupId);
t.check('stock is pooled into one bin', invAfter.length === 1, JSON.stringify(invAfter));
t.check('and the quantities are added, not replaced', Number(invAfter[0]?.quantity) === 10,
  `quantity=${invAfter[0]?.quantity}`);

const riAfter = (await rows('recipe_items')).filter(r => r.recipe_id === recipeId);
t.check('the recipe now points at the survivor',
  riAfter.length === 1 && riAfter[0].product_id === realId && riAfter[0].product_name === 'Tinned Tomatoes',
  JSON.stringify(riAfter));

// The line that broke everything. It is matched by NAME — invoice_lines has no
// product id column, which is exactly what the old code assumed it had.
const linesAfter = (await rows('invoice_lines')).filter(l => l.invoice_id === invId);
t.check('the invoice line was renamed to the surviving product',
  linesAfter.length === 1 && linesAfter[0].product_name === 'Tinned Tomatoes',
  JSON.stringify(linesAfter.map(l => l.product_name)));

// ── Group: two interchangeable items under one umbrella name ─────
const parmaId    = await mkProduct('Prosciutto di Parma DOP 24m');
const danieleId  = await mkProduct('Prosciutto San Daniele DOP 18m');
await mkEntry(parmaId,   'Prosciutto di Parma DOP 24m',   'Salumi Italia',     42.00);
await mkEntry(danieleId, 'Prosciutto San Daniele DOP 18m','Neptune Provisions', 39.50);

const group = await post(own, '/api/products/group', {
  general_name: 'Prosciutto Crudo', product_ids: [parmaId, danieleId],
});
t.check('group returns 200 (it has never once succeeded before)',
  group.status === 200, `status ${group.status} · ${JSON.stringify(group.data)}`);
t.check('it reports one product absorbed', group.data?.grouped_count === 1, JSON.stringify(group.data));

const gp2 = await rows('generic_products');
const survivor = gp2.find(p => p.id === group.data?.survivor_id);
const absorbed = gp2.find(p => p.id !== group.data?.survivor_id && [parmaId, danieleId].includes(p.id));
t.check('the survivor is renamed to the umbrella name',
  survivor?.name === 'Prosciutto Crudo', `name=${survivor?.name}`);
t.check('the absorbed product is archived, not left live and empty',
  !!absorbed?.deleted_at, `deleted_at=${absorbed?.deleted_at}`);

const entries2 = (await rows('product_entries')).filter(e => e.generic_product_id === group.data?.survivor_id);
t.check('both vendors\' purchases sit under the umbrella product', entries2.length === 2,
  `${entries2.length} entries`);

// The alias is the entire point of grouping: it is what routes the next invoice
// saying "Prosciutto di Parma DOP 24m" into the grouped product. It used to be
// written after the failing statement, so it never was.
const aliases = (await rows('product_aliases')).filter(a => a.generic_product_id === group.data?.survivor_id);
t.check('the absorbed name is remembered as an alias', aliases.length === 1,
  JSON.stringify(aliases.map(a => a.alias_name)));
t.check('and it is the name that was absorbed',
  aliases[0]?.alias_name === absorbed?.name, `${aliases[0]?.alias_name} vs ${absorbed?.name}`);

// ── Guards that must still refuse ────────────────────────────────
const self = await post(own, '/api/products/merge', { merged_id: realId, surviving_id: realId });
t.check('merging a product with itself is still refused', self.status === 400, `status ${self.status}`);

const missing = await post(own, '/api/products/merge', { merged_id: realId, surviving_id: 'no-such-id' });
t.check('an unknown product is still a 404', missing.status === 404, `status ${missing.status}`);

const tooFew = await post(own, '/api/products/group', { general_name: 'X', product_ids: [realId] });
t.check('grouping fewer than two products is still refused', tooFew.status === 400, `status ${tooFew.status}`);

t.done();
