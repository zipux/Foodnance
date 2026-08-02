// Pack facts from a purchase entry — public/static/utils.js
//
// Why this matters: recipes.js, finished-products.js and products.js all cost a
// product off one purchase entry, and each used to derive pack shape on its own.
// finished-products.js read a `pack_size` column that product_entries has never
// had (schema 0001 splits it into pack_qty + pack_unit), so every product came
// out as one nameless 'unit' priced at the whole line total — silently wrong on
// every finished product built from raw goods. These tests pin the two things
// that bug turned on: dedicated columns win, and `cost` is a LINE total that has
// to be divided by pack_qty x qty_ordered, not pack_qty alone.
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const { entryPackFacts } = loadBrowserModule(['utils.js'], ['entryPackFacts']);

const t = suite('pack-facts');
const facts = (e) => entryPackFacts(e);

t.section('Dedicated columns are the real schema');
const flour = facts({ pack_qty: 5, pack_unit: 'kg', qty_ordered: 1, cost: 4.5, cost_per_unit: 0.9 });
t.check('pack qty read from the column', flour.pack_qty === 5, `${flour.pack_qty}`);
t.check('pack unit read from the column', flour.pack_unit === 'kg', flour.pack_unit);
t.check('$0.90 per kg, not $4.50 per "unit"', t.near(flour.cost_per_unit, 0.9), `${flour.cost_per_unit}`);

t.section('cost is the LINE total — 5 x 10kg sacks at $165 is $3.30/kg');
// The real DEMO Potato row. Dividing by pack_qty alone gives $16.50 — the
// error finished-products.js shipped.
const potato = facts({ pack_qty: 10, pack_unit: 'kg', qty_ordered: 5, cost: 165, cost_per_unit: 3.3 });
t.check('stored cost_per_unit wins', t.near(potato.cost_per_unit, 3.3), `${potato.cost_per_unit}`);

const noStored = facts({ pack_qty: 10, pack_unit: 'kg', qty_ordered: 5, cost: 165 });
t.check('without it, divides by pack_qty x qty_ordered',
  t.near(noStored.cost_per_unit, 3.3), `${noStored.cost_per_unit}`);
t.check('and is NOT the per-pack figure', !t.near(noStored.cost_per_unit, 16.5), `${noStored.cost_per_unit}`);

const single = facts({ pack_qty: 5, pack_unit: 'kg', qty_ordered: 1, cost: 4.5 });
t.check('one pack ordered divides by pack_qty only', t.near(single.cost_per_unit, 0.9), `${single.cost_per_unit}`);

const noOrdered = facts({ pack_qty: 4, pack_unit: 'kg', cost: 8 });
t.check('missing qty_ordered is treated as 1', t.near(noOrdered.cost_per_unit, 2), `${noOrdered.cost_per_unit}`);

t.section('A canned drink keeps its per-each price');
const cola = facts({ pack_qty: 24, pack_unit: 'each', qty_ordered: 1, cost: 20.4, cost_per_unit: 0.85 });
t.check('24-can case is $0.85 each', t.near(cola.cost_per_unit, 0.85), `${cola.cost_per_unit}`);
t.check('and the unit stays "each"', cola.pack_unit === 'each', cola.pack_unit);

t.section('Legacy single-string shape still parses');
const legacy = facts({ pack_size: '5 kg', cost: 4.5 });
t.check('qty from the string', legacy.pack_qty === 5, `${legacy.pack_qty}`);
t.check('unit from the string', legacy.pack_unit === 'kg', legacy.pack_unit);
t.check('cost per unit from the string', t.near(legacy.cost_per_unit, 0.9), `${legacy.cost_per_unit}`);

const bothShapes = facts({ pack_size: '1 case', pack_qty: 12, pack_unit: 'each', cost: 24 });
t.check('columns beat the legacy string (qty)', bothShapes.pack_qty === 12, `${bothShapes.pack_qty}`);
t.check('columns beat the legacy string (unit)', bothShapes.pack_unit === 'each', bothShapes.pack_unit);

t.section('Unit casing is preserved — L is not l');
t.check("'L' survives", facts({ pack_qty: 2, pack_unit: 'L', cost: 6 }).pack_unit === 'L');
t.check("'Each' survives", facts({ pack_qty: 6, pack_unit: 'Each', cost: 6 }).pack_unit === 'Each');

t.section('Degenerate input never returns NaN or a divide-by-zero');
const empty = facts({});
t.check('no entry data -> qty 1', empty.pack_qty === 1, `${empty.pack_qty}`);
t.check("no entry data -> unit 'unit'", empty.pack_unit === 'unit', empty.pack_unit);
t.check('no entry data -> cost 0', empty.cost_per_unit === 0, `${empty.cost_per_unit}`);

const nullEntry = facts(null);
t.check('null entry is survivable', nullEntry.pack_qty === 1 && nullEntry.cost_per_unit === 0);

const zeroQty = facts({ pack_qty: 0, pack_unit: 'kg', cost: 10 });
t.check('pack_qty 0 falls back to 1, not Infinity',
  zeroQty.pack_qty === 1 && t.near(zeroQty.cost_per_unit, 10), JSON.stringify(zeroQty));

const blankUnit = facts({ pack_qty: 3, pack_unit: '   ', cost: 9 });
t.check("whitespace unit falls back to 'unit'", blankUnit.pack_unit === 'unit', `"${blankUnit.pack_unit}"`);

const negStored = facts({ pack_qty: 5, pack_unit: 'kg', qty_ordered: 1, cost: 4.5, cost_per_unit: 0 });
t.check('cost_per_unit of 0 is ignored, not trusted',
  t.near(negStored.cost_per_unit, 0.9), `${negStored.cost_per_unit}`);

t.done();
