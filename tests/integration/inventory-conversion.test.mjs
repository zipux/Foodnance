// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run dev:sandbox      (in another terminal)
//   npm run test:integration
//
// Exercises the real upsertInventory() from public/static/inventory.js against
// the live local API: a movement invoiced in one unit must land in the bin's
// unit, the stock log must agree with the bin, and an unconvertible movement
// must be refused outright rather than half-applied.
//
// It works on one fixed fixture product and clears its stock rows afterwards.
// Note: deleting a product through the API is a SOFT delete (a core invariant —
// purchase history must survive), so the fixture row itself stays behind,
// archived. The test revives and reuses that same row on each run rather than
// creating a new one, so nothing accumulates. It is hidden from the product
// list unless you tick "Archived".
import { loadBrowserModule } from '../helpers/browser-module.mjs';
import { suite } from '../helpers/assert.mjs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const ID   = 'ITEST_CONV_PRODUCT';

const api = loadBrowserModule(
  ['utils.js', 'inventory.js'],
  ['upsertInventory', 'findInvRow', 'apiGet', 'apiPost', 'apiPatch', 'apiDelete'],
  // Shadow fetch so utils.js's relative '/api/...' urls reach the sandbox.
  { fetch: (url, opts) => fetch(`${BASE}${url}`, opts) },
);

const t = suite('integration/inventory-conversion');

async function reachable() {
  try { await api.apiGet('tables/generic_products?limit=1'); return true; }
  catch { return false; }
}

// Clear the fixture's stock rows (these are true deletes) and archive the
// product so it stays out of the way between runs.
async function cleanup() {
  try {
    const inv = (await api.apiGet('tables/inventory?limit=500')).data || [];
    for (const r of inv.filter(x => x.item_id === ID)) await api.apiDelete(`tables/inventory/${r.id}`);
    const log = (await api.apiGet('tables/stock_log?limit=500')).data || [];
    for (const r of log.filter(x => x.item_id === ID)) await api.apiDelete(`tables/stock_log/${r.id}`);
    await api.apiDelete(`tables/generic_products/${ID}`);   // soft delete
  } catch { /* best effort */ }
}

// Create the fixture, or revive it if a previous run archived it.
async function ensureFixture() {
  const fields = {
    name: 'ITEST Conversion Potato', category: 'Produce',
    base_unit: 'kg', deleted_at: null,
  };
  try {
    await api.apiGet(`tables/generic_products/${ID}`);
    await api.apiPatch(`tables/generic_products/${ID}`, fields);   // revive + reset
  } catch {
    await api.apiPost('tables/generic_products', { id: ID, ...fields });
  }
}

if (!await reachable()) {
  console.log(`\nSKIPPED — no sandbox at ${BASE}. Start it with: npm run dev:sandbox\n`);
  process.exit(0);
}

await cleanup();
// A product stocked in kg; suppliers will invoice it in lb.
await ensureFixture();

try {
  t.section('A new bin opens in the product’s declared stocking unit');
  const first = await api.upsertInventory({
    itemId: ID, itemType: 'raw_material', itemName: 'ITEST Conversion Potato',
    category: 'Produce', unit: 'lb', change: 10, reason: 'ITEST first delivery',
  });
  t.check('bin unit is kg, not the invoiced lb', first.unit === 'kg', `got ${first.unit}`);
  t.check('10 lb stored as 4.535924 kg', t.near(parseFloat(first.quantity), 4.535924, 1e-5),
    `got ${first.quantity}`);

  t.section('Later movements convert into the existing bin');
  const second = await api.upsertInventory({
    itemId: ID, itemType: 'raw_material', itemName: 'ITEST Conversion Potato',
    category: 'Produce', unit: 'lb', change: 10, reason: 'ITEST second delivery',
  });
  t.check('bin now 9.071847 kg', t.near(parseFloat(second.quantity), 9.071847, 1e-5),
    `got ${second.quantity}`);

  t.section('The stock log records what actually moved');
  const log = ((await api.apiGet('tables/stock_log?limit=500')).data || [])
    .filter(l => l.item_id === ID);
  t.check('two movements logged', log.length === 2, `got ${log.length}`);
  t.check('logged in the bin’s unit, not the invoice’s',
    log.every(l => t.near(parseFloat(l.change), 4.535924, 1e-5)),
    log.map(l => l.change).join(', '));

  t.section('Same-unit movements pass straight through');
  const third = await api.upsertInventory({
    itemId: ID, itemType: 'raw_material', itemName: 'ITEST Conversion Potato',
    category: 'Produce', unit: 'kg', change: -9.071847, reason: 'ITEST reversal',
  });
  t.check('bin back to ~0', Math.abs(parseFloat(third.quantity)) < 1e-5, `got ${third.quantity}`);

  t.section('An unconvertible movement is refused, not half-applied');
  const before = parseFloat((await api.findInvRow(ID, 'raw_material')).quantity);
  let threw = null;
  try {
    await api.upsertInventory({
      itemId: ID, itemType: 'raw_material', itemName: 'ITEST Conversion Potato',
      category: 'Produce', unit: 'each', change: 5, reason: 'ITEST should be refused',
    });
  } catch (e) { threw = e; }
  t.check('each -> kg with no average weight throws', !!threw);
  t.check('error names both units',
    !!threw && /kg/.test(threw.message) && /each/.test(threw.message), threw?.message);
  const after = parseFloat((await api.findInvRow(ID, 'raw_material')).quantity);
  t.check('bin unchanged by the refused movement', t.near(before, after, 1e-9),
    `${before} -> ${after}`);
} finally {
  await cleanup();
}

t.done();
