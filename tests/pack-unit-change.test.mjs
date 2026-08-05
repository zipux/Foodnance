// Changing the pack-size unit must not rewrite a number the user typed before
// they reached the unit picker — public/static/products.js, onPackUnitChange().
//
// Two bugs found by hand-testing a pizzeria account on 2026-08-05, both of which
// put a WRONG NUMBER in the database silently, which is the dangerous kind:
// everything downstream is then perfectly consistent and simply wrong.
//
//   1. Add Product opens on kg. Type "5" meaning 5 lb, then pick lb, and the
//      pack size became 11.023113 — because the form treated the change as
//      "same amount, different unit". A 5 lb bag at $18.00 stored as $1.63/lb
//      instead of $3.60/lb, under half, in every recipe above it.
//
//   2. Add Product never reset the pack unit, so each new product inherited the
//      previous one's. When the inherited unit could not convert to the one
//      actually picked (each -> L), onPackUnitChange stopped on a "cannot
//      convert" prompt — about a product with no entries at all — and returned
//      before updateStockUnitVisibility(), so the product saved under the
//      PREVIOUS product's stocking unit. Five of twenty landed wrong.
//
// The distinction the fix rests on: converting is CORRECT when editing a saved
// entry (35 lb really is 15.876 kg) and WRONG on an entry being typed, where
// the figure was never in the old unit. So these tests pin both directions —
// a test that only checked "never converts" would pass a broken fix.
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const t = suite('pack-unit-change');

const UNITS = ['kg', 'g', 'lb', 'ml', 'L', 'each', 'case', 'oz', 'fl oz'];

// A DOM stub that mints an element for any id asked for. onPackUnitChange pulls
// in updateEntryCostPerUnit -> syncReorderUnit and updateStockUnitVisibility ->
// updatePackPreview, which between them touch a couple of dozen ids; naming
// them all would make this test a maintenance burden that fails on unrelated
// edits rather than on this behaviour.
function makeDom(unitOptions) {
  const els = new Map();
  const make = (id) => ({
    id, value: '', textContent: '', innerHTML: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, contains: () => false },
    options: unitOptions.includes(id) ? UNITS.map(u => ({ value: u, text: u })) : [],
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, dispatchEvent() {}, scrollIntoView() {}, appendChild() {},
    closest: () => null, remove() {},
  });
  // The "cannot convert" prompt is a hand-built overlay whose buttons resolve a
  // promise. Stub it so a regression REPORTS (promptShown) instead of hanging on
  // an answer that never comes, or crashing on a null button.
  const overlays = [];
  const makeOverlay = () => {
    const buttons = new Map();
    return {
      style: { cssText: '' }, innerHTML: '',
      querySelector: (s) => {
        if (!buttons.has(s)) buttons.set(s, { onclick: null });
        return buttons.get(s);
      },
    };
  };
  return {
    getElementById: (id) => { if (!els.has(id)) els.set(id, make(id)); return els.get(id); },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => makeOverlay(),
    body: {
      appendChild(node) {
        overlays.push(node);
        // onclick is assigned on the lines after appendChild, so answer on a
        // microtask — by then the handlers exist. Cancel, not Keep: the point is
        // that the prompt appeared at all, not which button was pressed.
        queueMicrotask(() => {
          const b = node.querySelector('#_ucc_cancel');
          if (b && b.onclick) b.onclick();
        });
      },
      removeChild() {},
    },
    _overlays: overlays,
    _els: els,
  };
}

// Drives one unit change and reports what happened to the typed pack size.
// `entries` seeds the sibling rows; `editingEntryId` marks an already-saved row.
async function change({ from, to, typedQty, entries = [], editingEntryId = '', productId = null }) {
  const document = makeDom(['ePackUnit', 'pStockUnit', 'pReorderUnit']);

  const { onPackUnitChange, _seed } = loadBrowserModule(
    ['utils.js', 'products.js'],
    ['onPackUnitChange',
     '_seed: (e, id) => { allEntries = e; currentGenericId = id; }'],
    {
      document,
      window: { addEventListener() {}, __accountType: 'restaurant', __accountPlan: 'essential' },
      confirm: () => true,
      alert: () => {},
    },
  );

  _seed(entries, productId);

  const sel = document.getElementById('ePackUnit');
  sel.value = from; sel.dataset.prevUnit = from;
  document.getElementById('ePackQty').value      = String(typedQty);
  document.getElementById('eQtyOrdered').value   = '1';
  document.getElementById('eCost').value         = '18.00';
  document.getElementById('editEntryId').value   = editingEntryId;
  document.getElementById('editProductId').value = productId || '';
  document.getElementById('pStockUnit').value    = from;

  sel.value = to;                       // what picking an option does
  await onPackUnitChange();

  return {
    qty:       document.getElementById('ePackQty').value,
    stockUnit: document.getElementById('pStockUnit').value,
    perUnit:   document.getElementById('eCostPerUnitDisplay').textContent,
    promptShown: document._overlays.length > 0,
  };
}

const SIBLING = [{ id: 'e1', generic_product_id: 'p1', pack_unit: 'kg', cost_per_unit: 2 }];

// ── Bug 1 ────────────────────────────────────────────────────────
t.section('bug 1 — a typed pack size survives picking the unit');

const newProduct = await change({ from: 'kg', to: 'lb', typedQty: 5 });
t.check('5 stays 5, not 11.023113', String(newProduct.qty) === '5', `got ${newProduct.qty}`);
t.check('per-unit price is $3.60 / lb, not $1.63',
  newProduct.perUnit.includes('3.60') && newProduct.perUnit.includes('lb'),
  newProduct.perUnit);

// Same trap one level in: the product exists, the ENTRY is still being typed.
const newEntryOnExistingProduct = await change({
  from: 'kg', to: 'lb', typedQty: 5, entries: SIBLING, productId: 'p1',
});
t.check('a new entry on an existing product keeps its typed 5 too',
  String(newEntryOnExistingProduct.qty) === '5', `got ${newEntryOnExistingProduct.qty}`);

// ── The behaviour that must NOT be lost ──────────────────────────
t.section('editing a SAVED entry still converts — 35 lb really is 15.876 kg');

const savedEntry = await change({
  from: 'lb', to: 'kg', typedQty: 35, editingEntryId: 'e1', entries: SIBLING, productId: 'p1',
});
const kg = parseFloat(savedEntry.qty);
t.check('35 lb becomes 15.876 kg', Math.abs(kg - 15.875733) < 0.0005, `got ${savedEntry.qty}`);

// ── Bug 2 ────────────────────────────────────────────────────────
t.section('bug 2 — the stocking unit follows the unit actually picked');

for (const [from, to] of [['each', 'L'], ['kg', 'each'], ['lb', 'L'], ['g', 'each']]) {
  const r = await change({ from, to, typedQty: 4 });
  t.check(`${from} -> ${to}: stocking unit becomes ${to}`,
    String(r.stockUnit).toLowerCase() === to.toLowerCase(),
    `got ${r.stockUnit}`);
  t.check(`${from} -> ${to}: no "cannot convert" prompt on a product with no entries`,
    r.promptShown === false);
  t.check(`${from} -> ${to}: typed 4 untouched`, String(r.qty) === '4', `got ${r.qty}`);
}

// Compatible units were never the broken case, but they share the code path now.
for (const [from, to] of [['kg', 'lb'], ['g', 'kg'], ['L', 'ml']]) {
  const r = await change({ from, to, typedQty: 4 });
  t.check(`${from} -> ${to}: stocking unit becomes ${to}`,
    String(r.stockUnit).toLowerCase() === to.toLowerCase(), `got ${r.stockUnit}`);
}

// The reported failure exactly: 20 products entered back to back, each picking
// its own unit, must each end up stocked in the unit it was bought in.
t.section('bug 2 — twenty products in a row, none inheriting the last one');

const SEQUENCE = ['kg','kg','lb','lb','L','kg','g','lb','kg','oz',
                  'kg','each','kg','g','lb','g','kg','each','each','each'];
let wrong = [];
for (let i = 0; i < SEQUENCE.length; i++) {
  // Each product opens on the reset default, per openAddProductModal.
  const r = await change({ from: 'kg', to: SEQUENCE[i], typedQty: 5 });
  if (String(r.stockUnit).toLowerCase() !== SEQUENCE[i].toLowerCase()) {
    wrong.push(`#${i + 1} wanted ${SEQUENCE[i]} got ${r.stockUnit}`);
  }
}
t.check('all 20 stocked in the unit they were bought in', wrong.length === 0, wrong.join('; '));

t.done();
