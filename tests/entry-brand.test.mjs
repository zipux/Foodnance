// A purchase remembers which brand it was.
//
// The invoice reader already extracts it — for one BCL invoice it correctly read
// "Sawmill Creek" off a 4 L box and "Verduzzo Delle Venezie" off 24 x 750 ml
// bottles — and BOTH save paths already send it to the server. The server simply
// never stored it: there was no column, and the INSERT never listed one. So two
// genuinely different wines sat under one (correctly) grouped product, one at
// $7.38/L and one at $23.84/L, with nothing on screen saying which was which.
// The only thing telling them apart in the database was the supplier's SKU.
//
// Grouping interchangeable items under one product is deliberate — the two-level
// model exists for exactly that — so this is a LABEL on each purchase, never
// part of what identifies a product. Making brand part of identity would split
// the group, which is the opposite of what is wanted.
//
// The brand is shown in the existing "Vendor Item" column rather than a new one:
// entries-table-columns.test.mjs exists because a header/cell mismatch shifts
// every column left and lands a cost under "Purchase Date", and there is no
// reason to take that risk for a field that belongs in that column anyway.
//
// THE SAFETY PROPERTY (section C) is the reason this shipped on its own:
// Price Movers decides "price change" vs "different item" from vendor_item_name.
// Storing the brand must not disturb that. Wiring brand into that decision is a
// separate, deliberate change — it has a real downside (a supplier rewording a
// line would mask a genuine price rise), and it is not this one.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = suite('entry-brand');

const backendSrc = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');

// ── A. The column is written on import ───────────────────────────
t.section('A. the import stores the brand it already receives');
const insert = backendSrc.match(/INSERT INTO product_entries[\s\S]{0,2000}?\.run\(\)/);
t.check('the product_entries INSERT exists', !!insert);
const insertSrc = insert ? insert[0] : '';
t.check('its column list includes brand', /\(\s*id,[\s\S]*?\bbrand\b/.test(insertSrc),
  'the brand is sent by both save paths and would otherwise be dropped on the floor');
t.check('it binds p.brand', /p\.brand/.test(insertSrc), insertSrc.slice(0, 120));
t.check('placeholders still match the column list', (() => {
  const cols = (insertSrc.match(/INSERT INTO product_entries\s*\n?\s*\(([\s\S]*?)\)/) || [])[1];
  const vals = (insertSrc.match(/VALUES\s*\(([^)]*)\)/) || [])[1];
  if (!cols || !vals) return false;
  return cols.split(',').length === vals.split(',').length;
})(), 'a column added without a placeholder is a runtime error on every invoice save');

t.section('A2. and a migration adds the column');
const migration = readFileSync(join(ROOT, 'migrations/0049_entry_brand.sql'), 'utf8');
t.check('0049 adds brand to product_entries',
  /ALTER TABLE\s+product_entries\s+ADD COLUMN\s+brand/i.test(migration));
t.check('with a non-null default, so existing rows read as blank not null',
  /DEFAULT\s+''/.test(migration));

// ── B. It shows up where you look for it ─────────────────────────
const ENTRY = (over = {}) => ({
  id: 'e1', generic_product_id: 'p1',
  supplier_name: 'BCL', vendor_item_name: 'Pinot Grigio', brand: '',
  sku: '171926', pack_qty: 4, pack_unit: 'L', qty_ordered: 1,
  cost: 29.52, cost_per_unit: 7.38,
  purchase_date: '2026-05-18', expiry_date: '', invoice_ref: '', invoice_id: '',
  ...over,
});

function render(entries) {
  const th = { entriesExpiryCol: { style: {} }, entriesInvoiceCol: { style: {} } };
  const els = {
    ...th,
    entriesTableScroll: { classList: { add() {}, remove() {} } },
    entriesBody:        { innerHTML: '' },
    entriesShowMore:    { style: {}, querySelector: () => ({ innerHTML: '' }) },
  };
  const { renderEntriesTable, _seed } = loadBrowserModule(
    ['utils.js', 'products.js'],
    ['renderEntriesTable', '_seed: (rows) => { allEntries = rows; }'],
    {
      window: { addEventListener() {}, __accountType: 'commissary', __accountPlan: 'pro' },
      document: {
        addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
        body: {}, getElementById: (id) => els[id] || null,
      },
    },
  );
  _seed(entries);
  renderEntriesTable('p1');
  return { html: els.entriesBody.innerHTML, cells: (els.entriesBody.innerHTML.match(/<td[\s>]/g) || []).length };
}

t.section('B. the two wines are finally distinguishable');
const both = render([
  ENTRY({ id: 'a', brand: 'Sawmill Creek',          pack_qty: 4,   pack_unit: 'L',  cost_per_unit: 7.38  }),
  ENTRY({ id: 'b', brand: 'Verduzzo Delle Venezie', pack_qty: 750, pack_unit: 'ml', cost_per_unit: 0.02384, sku: '244681' }),
]);
t.check('the box shows its brand', both.html.includes('Sawmill Creek'), both.html.slice(0, 200));
t.check('the bottles show theirs', both.html.includes('Verduzzo Delle Venezie'));
t.check('they are no longer both just "Pinot Grigio"',
  both.html.split('Pinot Grigio').length - 1 < 2,
  'the generic name should have been replaced by the brand in both rows');

t.section('B2. it falls back gracefully');
const noBrand = render([ENTRY({ brand: '' })]);
t.check('no brand falls back to the vendor item name', noBrand.html.includes('Pinot Grigio'));
const neither = render([ENTRY({ brand: '', vendor_item_name: '' })]);
t.check('neither one renders a dash, not "undefined"',
  neither.html.includes('—') && !/undefined/.test(neither.html));
const missing = render([(() => { const e = ENTRY(); delete e.brand; return e; })()]);
t.check('an old row with no brand column at all still renders',
  missing.html.includes('Pinot Grigio') && !/undefined/.test(missing.html));

t.section('B3. adding it did not disturb the table');
t.check('cell count unchanged — brand reuses the Vendor Item column', both.cells / 2 === 10,
  `${both.cells / 2} cells per row`);
t.check('a brand is escaped like any other text', (() => {
  const x = render([ENTRY({ brand: '<img src=x onerror=alert(1)>' })]);
  return !x.html.includes('<img src=x') && x.html.includes('&lt;img');
})(), 'brand comes from a parsed invoice, i.e. from a document a stranger wrote');

// ── C. The safety property: Price Movers is untouched ────────────
t.section('C. storing the brand does not change what Price Movers decides');
const kindBlock = backendSrc.match(/let change_kind[\s\S]*?\n    \}/);
t.check('the change_kind classifier exists', !!kindBlock);
t.check('it still compares vendor_item, not brand',
  !!kindBlock && /vendor_item/.test(kindBlock[0]) && !/\bbrand\b/.test(kindBlock[0]),
  'wiring brand into this is a separate decision: a supplier rewording a line '
  + 'would flip a real price rise to "different item" and hide the red arrow');
t.check('the price-movers query does not select brand',
  !/pe\.brand/.test(backendSrc),
  'nothing in the comparison path should read it yet');

t.done();
