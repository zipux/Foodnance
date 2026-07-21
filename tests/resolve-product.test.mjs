// Invoice line -> product resolution — public/static/invoices.js
//
// A supplier's wording often isn't your product name ("Grape Tomatoes" vs
// "Small Tomatoes"). Stock-in resolves a line the same way the invoice import
// does: an explicit link chosen on the review screen, then exact name, then an
// alias registered for THAT supplier, then a global alias.
//
// The precedence cases matter most: two vendors can use the same word for
// different items, so a supplier-scoped alias has to beat a global one.
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const { _resolveRowProduct } = loadBrowserModule(['invoices.js'], ['_resolveRowProduct']);

const t = suite('resolve-product');

const POTATO   = { id: 'P1', name: 'DEMO Potato', category: 'Produce' };
const ARCHIVED = { id: 'P2', name: 'Old Potato',  category: 'Produce', deleted_at: '2026-01-01' };
const CARROT   = { id: 'P3', name: 'Carrot',      category: 'Produce' };
const products = [POTATO, ARCHIVED, CARROT];

const aliases = [
  { alias_name: 'Spuds',  generic_product_id: 'P1', supplier_id: 'NEPTUNE' },
  { alias_name: 'Taters', generic_product_id: 'P1', supplier_id: null      },
  { alias_name: 'Ghost',  generic_product_id: 'P2', supplier_id: null      }, // -> archived
  { alias_name: 'Clash',  generic_product_id: 'P3', supplier_id: null      }, // global -> Carrot
  { alias_name: 'Clash',  generic_product_id: 'P1', supplier_id: 'NEPTUNE' }, // scoped -> Potato
];

const row = (name, extra = {}) => ({ product_name: name, ...extra });
const resolves = (label, r, supplierId, wantId) => {
  const got = _resolveRowProduct(r, products, aliases, supplierId);
  t.check(label, (got ? got.id : null) === wantId, `got ${got ? got.id : null}, wanted ${wantId}`);
};

t.section('Exact name (the old code used a strict === and missed these)');
resolves('exact match',          row('DEMO Potato'),     null, 'P1');
resolves('different case',       row('demo potato'),     null, 'P1');
resolves('untrimmed whitespace', row('  DEMO Potato '),  null, 'P1');

t.section('Supplier-scoped alias');
resolves('Spuds from Neptune',                 row('Spuds'), 'NEPTUNE', 'P1');
resolves('Spuds from Yen (scoped elsewhere)',  row('Spuds'), 'YEN',     null);
resolves('Spuds with no supplier known',       row('Spuds'), null,      null);

t.section('Global alias applies to any vendor');
resolves('Taters from Yen',        row('Taters'), 'YEN', 'P1');
resolves('Taters with no supplier', row('Taters'), null,  'P1');

t.section('Precedence: supplier-scoped beats global');
resolves('Clash from Neptune -> Potato', row('Clash'), 'NEPTUNE', 'P1');
resolves('Clash from Yen -> Carrot',     row('Clash'), 'YEN',     'P3');

t.section('An explicit link from the review screen wins');
resolves('link overrides the name',        row('Carrot', { _link_product_id: 'P1' }), null, 'P1');
resolves('stale link id falls back to name', row('Carrot', { _link_product_id: 'GONE' }), null, 'P3');

t.section('Must not resolve');
resolves('alias pointing at an archived product', row('Ghost'),  null, null);
resolves('unknown name',                          row('Turnip'), null, null);
resolves('empty name',                            row(''),       null, null);

t.done();
