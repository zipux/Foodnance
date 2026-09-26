// The Variance column in the product modal's entries table —
// public/static/products.js, renderEntriesTable().
//
// Each entry's cost_per_unit is in its OWN pack unit. The column used to compare
// those raw figures, so once a product held purchases in two units (a merge put
// Neptune's $4.85/lb beside YEN BROS's $0.0109/g on Cherry Tomatoes) it read
// +44,253%. Now each entry is converted into the latest entry's unit first; a
// unit that can't be bridged shows "—".
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const t = suite('entries-variance');

function run(entries, generic = { id: 'p1', name: 'Cherry Tomatoes', base_unit: 'g' }) {
  const els = {
    entriesExpiryCol:   { style: {} },
    entriesInvoiceCol:  { style: {} },
    entriesTableScroll: { classList: { add() {}, remove() {} } },
    entriesBody:        { innerHTML: '' },
    entriesShowMore:    { style: {}, querySelector: () => ({ innerHTML: '' }) },
  };
  const { renderEntriesTable, _seed } = loadBrowserModule(
    ['utils.js', 'products.js'],
    ['renderEntriesTable', '_seed: (rows, g) => { allEntries = rows; allGeneric = g; }'],
    {
      window: { addEventListener() {}, __accountType: 'restaurant', __accountPlan: 'pro' },
      document: {
        addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
        body: {}, getElementById: (id) => els[id] || null,
      },
    },
  );
  _seed(entries, [generic]);
  renderEntriesTable('p1');
  // One variance cell per row, newest first — the only cell with this style.
  return [...els.entriesBody.innerHTML.matchAll(
    /<td style="font-weight:600;font-size:\.82rem;[^"]*"(?: title="([^"]*)")?>([^<]*)<\/td>/g
  )].map(m => ({ text: m[2].trim(), title: m[1] || '' }));
}

const YEN = {
  id: 'yen', generic_product_id: 'p1', supplier_name: 'YEN BROS',
  pack_qty: 3408, pack_unit: 'g', qty_ordered: 1,
  cost: 37.26, cost_per_unit: 0.010933098591549294, purchase_date: '2026-07-10',
};
const NEPTUNE = {
  id: 'nep', generic_product_id: 'p1', supplier_name: 'Neptune Fresh Produce Inc.',
  pack_qty: 12, pack_unit: 'lb', qty_ordered: 3,
  cost: 174.57, cost_per_unit: 4.849166666666666, purchase_date: '2026-05-01',
};

t.section('mixed units: the Demo account cherry tomatoes ($/g latest, $/lb before)');
{
  const v = run([YEN, NEPTUNE]);
  t.check('two rows', v.length === 2, `got ${v.length}`);
  t.check('latest row is 0.0%', v[0].text === '0.0%', v[0].text);
  t.check('Neptune reads -2.2%, not +44,253%', v[1].text === '-2.2%', v[1].text);
}

t.section('same unit: unchanged from before');
{
  const a = { ...YEN, id: 'a', purchase_date: '2026-08-01', cost_per_unit: 0.012 };
  const b = { ...YEN, id: 'b', purchase_date: '2026-07-01', cost_per_unit: 0.010 };
  const v = run([a, b]);
  t.check('older row is -16.7%', v[1].text === '-16.7%', v[1].text);
}

t.section("a unit that can't be converted shows — with a reason");
{
  const box = { ...NEPTUNE, id: 'box', pack_unit: 'case', pack_qty: 1, qty_ordered: 1, cost: 40, cost_per_unit: 40 };
  const v = run([YEN, box]);
  t.check('shows —', v[1].text === '—', v[1].text);
  t.check('hover explains why', /Can't compare/.test(v[1].title), v[1].title);
}

t.section('each ↔ weight uses the product average weight');
{
  const each = { ...NEPTUNE, id: 'each', pack_unit: 'each', pack_qty: 10, qty_ordered: 1, cost: 5.5, cost_per_unit: 0.55 };
  // 0.05 kg each → $0.55/each = $11/kg = $0.011/g vs latest $0.010933/g → +0.6%
  const v = run([YEN, each], { id: 'p1', name: 'Cherry Tomatoes', base_unit: 'g', avg_weight_per_unit: 0.05 });
  t.check('converted via average weight', v[1].text === '+0.6%', v[1].text);
  const w = run([YEN, each]);
  t.check('no average weight → —', w[1].text === '—', w[1].text);
}

t.done();
