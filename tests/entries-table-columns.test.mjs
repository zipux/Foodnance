// The supplier-entries table drops its Expiry and Invoice columns for an
// Essential restaurant — public/static/products.js, renderEntriesTable().
//
// account-type-gating.test.mjs already pins the three FORM fields, which
// applyBatchWorkflowGating() hides once at bootstrap. The columns cannot work
// that way: the table body is rebuilt on every render, so header and cells have
// to be decided by the same call at the same moment. Get that wrong and the
// header is hidden while the cells are not — every column after it shifts one
// place left, and a cost lands under "Purchase Date".
//
// So the assertion that matters here is not "the invoice ref is gone", it is
// that the number of cells still matches the number of visible headers.
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const t = suite('entries-table-columns');

// Every <th> in the entries table, in order — products.html. The two that get
// hidden are marked; the rest are always there.
const HEADERS = ['Vendor', 'Vendor Item', 'Pack Size', 'Cost', 'Cost/Unit',
                 'Purchase Date', 'Expiry*', 'Invoice*', 'Variance', ''];
const ALWAYS  = HEADERS.filter(h => !h.endsWith('*')).length;   // 8
const TOGGLED = HEADERS.length - ALWAYS;                        // 2

const ENTRY = {
  id: 'e1', generic_product_id: 'p1',
  supplier_name: 'Rossi Foods', vendor_item_name: 'Rossi Parmesan Grated',
  sku: 'GP-1KG', pack_qty: 5, pack_unit: 'kg', qty_ordered: 1,
  cost: 82, cost_per_unit: 16.4,
  purchase_date: '2026-07-12', expiry_date: '2026-11-30',
  invoice_ref: 'INV-2214', invoice_id: 'inv-1',
};

function run(accountType, plan) {
  const th = { entriesExpiryCol: { style: {} }, entriesInvoiceCol: { style: {} } };
  const els = {
    ...th,
    entriesTableScroll: { classList: { add() {}, remove() {} } },
    entriesBody:        { innerHTML: '' },
    entriesShowMore:    { style: {}, querySelector: () => ({ innerHTML: '' }) },
  };
  // The helper splices these names straight into a `return { … }` literal, so a
  // property whose value is a closure reaches products.js's module scope. That
  // is the only way to seed `allEntries`, which is a plain top-level `let`.
  const { renderEntriesTable, _seed } = loadBrowserModule(
    ['utils.js', 'products.js'],
    ['renderEntriesTable', '_seed: (rows) => { allEntries = rows; }'],
    {
      window: { addEventListener() {}, __accountType: accountType, __accountPlan: plan },
      document: {
        addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
        body: {}, getElementById: (id) => els[id] || null,
      },
    },
  );

  _seed([ENTRY]);
  renderEntriesTable('p1');

  const html = els.entriesBody.innerHTML;
  return {
    cells:   (html.match(/<td[\s>]/g) || []).length,
    hidden:  Object.values(th).every(e => e.style.display === 'none'),
    shown:   Object.values(th).every(e => e.style.display === ''),
    html,
  };
}

t.section('an Essential restaurant loses both columns, header and cells together');
const ess = run('restaurant', 'essential');
t.check(`row has ${ALWAYS} cells, not ${ALWAYS + TOGGLED}`, ess.cells === ALWAYS, `got ${ess.cells}`);
t.check('both headers hidden', ess.hidden === true);
t.check('the expiry date is really gone', !ess.html.includes('2026-11-30') && !/Nov/.test(ess.html));
t.check('the invoice ref and its link are really gone',
  !ess.html.includes('INV-2214') && !ess.html.includes('/invoices.html'));
// The point of the whole test: a mismatch here is the column-shift bug.
t.check('cells match the visible headers', ess.cells === ALWAYS && ess.hidden);

t.section('a Pro restaurant keeps them — it counts stock, so dates do work');
const pro = run('restaurant', 'pro');
t.check(`row has all ${ALWAYS + TOGGLED} cells`, pro.cells === ALWAYS + TOGGLED, `got ${pro.cells}`);
t.check('both headers shown', pro.shown === true);
t.check('the invoice links back to /invoices', pro.html.includes('/invoices.html'));
t.check('cells match the visible headers', pro.cells === ALWAYS + TOGGLED && pro.shown);

t.section('a commissary keeps them on every plan');
for (const plan of ['essential', 'pro']) {
  const c = run('commissary', plan);
  t.check(`${plan}: all ${ALWAYS + TOGGLED} cells`, c.cells === ALWAYS + TOGGLED, `got ${c.cells}`);
  t.check(`${plan}: headers shown`, c.shown === true);
}

// Same rule as the form fields: the session bootstrap is async, so the first
// render of any page happens before the plan is known. Showing a column and
// then dropping it is recoverable; the reverse leaves a gap.
t.section('unknown account keeps everything');
for (const [type, plan] of [[undefined, undefined], ['', ''], [undefined, 'pro']]) {
  const un = run(type, plan);
  t.check(`type=${JSON.stringify(type)} plan=${JSON.stringify(plan)}: all cells`,
    un.cells === ALWAYS + TOGGLED && un.shown, `got ${un.cells}`);
}

t.done();
