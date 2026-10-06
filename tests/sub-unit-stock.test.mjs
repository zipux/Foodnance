// Stock movements for a product bought by the pack (2026-10-06).
//
// San Marzano tomatoes: bought by the case, 6 cans to a case, one can 0.8 kg.
// Costing has understood that since sub-unit-weight (tests/sub-unit-weight.test.mjs);
// stock did not: a recipe line in cans or grams against a bin counted in cases
// either stopped (Produce Batch), was skipped (sales) or, in Pack Run, took the
// bare number — 20 cans left the shelf as 20 cases.
//
// The rule lives twice, in the browser (invSubUnitFactor) and in the worker
// (subUnitFactor); the last section fails if the two ever disagree.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = suite('sub-unit-stock');

const { invConvertQty, invConvertUnitCost, invSubOf, fifoEntryQtyIn } =
  loadBrowserModule(['utils.js'], ['invConvertQty', 'invConvertUnitCost', 'invSubOf', 'fifoEntryQtyIn']);

// The worker's copy, lifted out of src/index.ts with its types stripped.
const backendSrc = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');
function extractFn(name) {
  const m = backendSrc.match(new RegExp(`^function ${name}\\s*\\([\\s\\S]*?^\\}`, 'm'));
  if (!m) throw new Error(`could not find top-level function ${name}() in src/index.ts`);
  const b = m[0];
  const open = b.indexOf('(');
  // The body's brace is the one that ends a line; return types may hold braces.
  const brace = b.search(/\{\s*\n/);
  const close = b.lastIndexOf(')', brace);
  const params = b.slice(open + 1, close).split(',').map(p => p.split(':')[0].trim()).filter(Boolean);
  return `function ${name}(${params.join(', ')}) ${b.slice(brace)}`;
}
const unitTable = backendSrc.match(/^const UNIT_FACTORS[^=]*= \{[\s\S]*?^\}/m);
const server = new Function([
  unitTable[0].replace(/^const UNIT_FACTORS[^=]*=/, 'const UNIT_FACTORS ='),
  ...['unitInfo', 'sameUnitName', 'isEachUnit', 'subUnitFactor', 'convertUnitCost', 'convertQty', 'subUnitOf'].map(extractFn),
  'return { convertQty, convertUnitCost, subUnitOf };',
].join('\n'))();

const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;
const SUB = { name: 'can', qty: 6 };
const CAN_KG = 0.8;

t.section('browser: cans, cases and weight');
t.check('2 cans = a third of a case', near(invConvertQty(2, 'can', 'case', CAN_KG, SUB).qty, 2 / 6));
t.check('20 cans = 3.33 cases, not 20', near(invConvertQty(20, 'can', 'case', null, SUB).qty, 20 / 6));
t.check('1 case = 6 cans', near(invConvertQty(1, 'case', 'can', null, SUB).qty, 6));
t.check('800 g = 1 can', near(invConvertQty(800, 'g', 'can', CAN_KG, SUB).qty, 1));
t.check('8 kg = 10 cans = 1.67 cases', near(invConvertQty(8, 'kg', 'case', CAN_KG, SUB).qty, 10 / 6));
t.check('1 case = 4.8 kg', near(invConvertQty(1, 'case', 'kg', CAN_KG, SUB).qty, 4.8));
t.check('1 lb of it, in cans', near(invConvertQty(1, 'lb', 'can', CAN_KG, SUB).qty, 0.45359237 / 0.8));
t.check('the sub-unit name is matched whatever its capitals', near(invConvertQty(2, 'Can', 'Case', null, SUB).qty, 2 / 6));
t.check('there and back gives the same number',
  near(invConvertQty(invConvertQty(7, 'case', 'g', CAN_KG, SUB).qty, 'g', 'case', CAN_KG, SUB).qty, 7));

t.section('browser: any pack word is the same pack');
t.check('a box bought into a bin of cases is one for one', near(invConvertQty(3, 'box', 'case', null, SUB).qty, 3));
t.check('a carton is 6 cans too', near(invConvertQty(1, 'carton', 'can', null, SUB).qty, 6));

t.section('browser: it never guesses');
t.check('weight with no can weight is refused', !!invConvertQty(500, 'g', 'case', null, SUB).error);
t.check('and the refusal says what to fill in', /weight of one can/i.test(invConvertQty(500, 'g', 'case', null, SUB).error || ''));
t.check('cans to cases needs no weight', !invConvertQty(2, 'can', 'case', null, SUB).error);
t.check('volume stays out (weight only, by decision)', !!invConvertQty(500, 'ml', 'case', CAN_KG, SUB).error);
t.check('"each" is not a pack', !!invConvertQty(2, 'each', 'case', null, SUB).error);
t.check('a product with no sub-unit is refused exactly as before',
  invConvertQty(2, 'can', 'case', CAN_KG, null).error === 'Cannot convert can to case'
  && invConvertQty(2, 'can', 'case', CAN_KG).error === 'Cannot convert can to case');
t.check('units per pack of zero is no sub-unit', !!invConvertQty(2, 'can', 'case', null, { name: 'can', qty: 0 }).error);

t.section('browser: nothing that converted before has moved');
t.check('kg to g', near(invConvertQty(2, 'kg', 'g', CAN_KG, SUB).qty, 2000));
t.check('lb to kg', near(invConvertQty(1, 'lb', 'kg', null, SUB).qty, 0.45359237));
t.check('each to kg still uses the weight as "per each"', near(invConvertQty(3, 'each', 'kg', 0.2, SUB).qty, 0.6));
t.check('same unit is untouched', invConvertQty(5, 'case', 'case', null, SUB).qty === 5);

t.section('browser: the price follows the quantity');
t.check('$36 a case is $6 a can', near(invConvertUnitCost(36, 'case', 'can', null, SUB).cost, 6));
t.check('$36 a case is $7.50 a kg', near(invConvertUnitCost(36, 'case', 'kg', CAN_KG, SUB).cost, 7.5));
t.check('value is the same either way: 9 cans at $6 = 1.5 cases at $36',
  near(9 * invConvertUnitCost(36, 'case', 'can', null, SUB).cost, invConvertQty(9, 'can', 'case', null, SUB).qty * 36));
t.check('without a sub-unit the cost is still refused', !!invConvertUnitCost(36, 'case', 'can', null).error);

t.section('browser: reading the product, and purchases on one axis');
t.check('sub-unit read from a product', invSubOf({ sub_unit_name: ' can ', sub_unit_qty: '6' })?.name === 'can'
  && invSubOf({ sub_unit_name: 'can', sub_unit_qty: '6' }).qty === 6);
t.check('none when either half is missing', invSubOf({ sub_unit_name: 'can' }) === null
  && invSubOf({ sub_unit_qty: 6 }) === null && invSubOf(null) === null);
const twoCases = { pack_qty: 1, pack_unit: 'case', qty_ordered: 2 };
t.check('2 cases bought count as 12 in a bin of cans', near(fifoEntryQtyIn(twoCases, 'can', null, SUB), 12));
t.check('and are still left out when the product has no sub-unit', fifoEntryQtyIn(twoCases, 'can', null) === null);

t.section('server: the same answers');
const pairs = [
  [2, 'can', 'case', CAN_KG], [20, 'can', 'case', null], [1, 'case', 'can', null], [800, 'g', 'can', CAN_KG],
  [8, 'kg', 'case', CAN_KG], [1, 'case', 'kg', CAN_KG], [1, 'lb', 'can', CAN_KG], [3, 'box', 'case', null],
  [500, 'g', 'case', null], [500, 'ml', 'case', CAN_KG], [2, 'each', 'case', null], [2, 'kg', 'g', CAN_KG],
  [3, 'each', 'kg', 0.2], [5, 'oz', 'case', CAN_KG], [4, 'Can', 'KG', CAN_KG],
];
let agree = true, detail = '';
for (const [q, from, to, w] of pairs) {
  for (const sub of [SUB, null]) {
    const b = invConvertQty(q, from, to, w, sub), s = server.convertQty(q, from, to, w, sub);
    const same = (b.error && s.error) || near(b.qty, s.qty);
    if (!same) { agree = false; detail = `${q} ${from}→${to} sub=${!!sub}: browser ${JSON.stringify(b)} server ${JSON.stringify(s)}`; }
  }
}
t.check('browser and server convert every pair alike', agree, detail);
t.check('server: 20 cans = 3.33 cases', near(server.convertQty(20, 'can', 'case', null, SUB).qty, 20 / 6));
t.check('server: refusal names the missing can weight',
  /weight of one can/.test(server.convertQty(500, 'g', 'case', null, SUB).error || ''));
t.check('server: $36 a case is $6 a can', near(server.convertUnitCost(36, 'case', 'can', null, SUB), 6));
t.check('server: $36 a case is $7.50 a kg', near(server.convertUnitCost(36, 'case', 'kg', CAN_KG, SUB), 7.5));
t.check('server: no sub-unit, no price', server.convertUnitCost(36, 'case', 'can', null, null) === null
  && server.convertUnitCost(36, 'case', 'can', null) === null);
t.check('server: a missing can weight gives no price rather than a wrong one',
  server.convertUnitCost(36, 'case', 'kg', null, SUB) === null);
t.check('server: sub-unit read from a product row', server.subUnitOf({ sub_unit_name: 'can', sub_unit_qty: 6 })?.qty === 6
  && server.subUnitOf({ sub_unit_name: '', sub_unit_qty: 6 }) === null);

t.section('every stock path is given the sub-unit');
const read = (f) => readFileSync(join(ROOT, 'public/static', f), 'utf8');
const inv = read('inventory.js'), fp = read('finished-products.js'), rec = read('recipes.js'),
      prod = read('products.js'), utils = read('utils.js');
t.check('stock movements (Produce Batch, stock-in, Pack Run all write through here)',
  /invConvertQty\(change, incomingUnit, binUnit, avgW, invSubOf\(product\)\)/.test(inv));
t.check('the Inventory page values a bin with it', /invConvertUnitCost\(rawCpu, pUnit, binUnit \|\| pUnit, avgWKg, invSubOf\(g\)\)/.test(inv));
t.check('changing the stocking unit converts what is on hand', /_convertQuantity\(oldQty, oldUnit, newUnit, avgW, invSubOf\(g\)\)/.test(prod));
t.check('the price layer: cost index', /\{ alwaysLatest, sub: invSubOf\(g\) \}/.test(utils));
t.check('the price layer: recipes, finished products, inventory',
  /fifoActiveEntry\(entries, invQty, stockUnit, avgWKg, invSubOf\(g\)\)/.test(rec)
  && /fp_fifoActiveEntry\(myEntries, invQty, stockUnit, avgWKg, invSubOf\(g\)\)/.test(fp)
  && /invFifoActiveEntry\(myEntries, invQty, binUnit, avgWKg, invSubOf\(g\)\)/.test(inv));
t.check('sales import', /convertQty\(a\.qty, a\.unit \|\| binUnit, binUnit, avgW, subUnitOf\(prod\)\)/.test(backendSrc)
  && /avg_weight_per_unit, sub_unit_name, sub_unit_qty, category\s+FROM generic_products/.test(backendSrc));
t.check('stock-take value', /convertUnitCost\(rate, packUnit, binUnit, avgWeight\.get\(productId\) \?\? null, subUnit\.get\(productId\) \?\? null\)/.test(backendSrc));

t.section('Pack Run stops instead of guessing');
const run = fp.slice(fp.indexOf('async function confirmPackRun'), fp.indexOf('async function confirmPackRun') + 2500);
const line = fp.slice(fp.indexOf('function prLineDeduction'), fp.indexOf('function updatePrPreview'));
t.check('no silent factor of 1 is left in the file', !/fp_conversionFactor\([^)]*\) \?\? 1/.test(fp));
t.check('one helper feeds both the preview and the run',
  /prLineDeduction\(it, units\)/.test(fp.slice(fp.indexOf('function updatePrPreview'), fp.indexOf('async function confirmPackRun')))
  && /prFpItems\.map\(it => prLineDeduction\(it, units\)\)/.test(run));
t.check('it converts with the product\'s sub-unit', /invConvertQty\(lineQty, lineUnit, invUnit, avgW, invSubOf\(prod\)\)/.test(line));
t.check('an unconvertible line is an error, not a number', /if \(conv\.error\) \{\s*return \{ it, error:/.test(line));
t.check('the run checks every line before the first deduction',
  run.indexOf('lines.find(l => l.error)') > -1 && run.indexOf('lines.find(l => l.error)') < run.indexOf('upsertInventory'));
t.check('and writes nothing when one is bad', /if \(bad\) \{ showToast\([^)]*\); return; \}/.test(run));

t.section('Produce Batch checks every line before the first write');
const pb = rec.slice(rec.indexOf('async function confirmProduceBatch'), rec.indexOf('async function confirmProduceBatch') + 5000);
const plan = inv.slice(inv.indexOf('async function planInventoryMove'), inv.indexOf('async function upsertInventory'));
const ups  = inv.slice(inv.indexOf('async function upsertInventory'), inv.indexOf('async function upsertInventory') + 1500);
t.check('working out a movement writes nothing', !/apiPatch|apiPost|logStockMove/.test(plan) && /throw new Error/.test(plan));
t.check('the real movement goes through the very same step', /await planInventoryMove\(\{ itemId, itemType, itemName, unit, change \}\)/.test(ups));
t.check('pages can reach it', /window\.invHelpers = \{[^}]*planInventoryMove/.test(inv));
const iCheck = pb.indexOf('planInventoryMove(m)'), iFlip = pb.indexOf("production_mode: 'batched'"), iWrite = pb.indexOf('upsertInventory(m)');
t.check('checked, then marked made-ahead, then written', iCheck > -1 && iCheck < iFlip && iFlip < iWrite, `${iCheck} ${iFlip} ${iWrite}`);
t.check('the batch going in is checked along with the ingredients',
  /moves\.push\(\{\s*itemId:\s*pbRecipeId/.test(pb) && pb.indexOf('itemId:    pbRecipeId') < iCheck);
t.check('a bad line records nothing and says so', /showToast\(`Batch not recorded\. \$\{e\.message\}`, 'error'\);\s*return;/.test(pb));
t.check('what is checked is what is written (one list)', (pb.match(/upsertInventory\(/g) || []).length === 1);

t.section('a sales import adds up every amount, in every unit');
const salesPlan = backendSrc.slice(backendSrc.indexOf('for (const d of res.deductions)'), backendSrc.indexOf('for (const [key, msg] of lineErrors)'));
t.check('one running total per ingredient, day AND unit', /\$\{l\.sold_date\}\|\$\{d\.item_type\}\|\$\{d\.item_id\}\|\$\{String\(d\.unit/.test(salesPlan));
t.check('an amount is always added, never set over the one before', /if \(cur\) cur\.qty \+= d\.qty/.test(salesPlan) && !/agg\.set\(key \+ '\|'/.test(salesPlan));
t.check('no conversion is attempted without the product\'s facts', !/convertQty\([^)]*, null\)/.test(salesPlan));
t.check('the per-unit totals fold back into one movement per ingredient per day',
  /moveByDayItem\.get\(dayItem\)/.test(salesPlan) && /already\.qty = Math\.round\(\(already\.qty \+ qty\)/.test(salesPlan));

t.section('lists sent to the database stay under its 100-value limit');
t.check('the chunk size leaves room for the other bound values', /const D1_IN_CHUNK = 90\b/.test(backendSrc));
const lists = [...backendSrc.matchAll(/IN \(\$\{(\w+)\.map\(\(\) => '\?'\)\.join\(','\)\}\)/g)].map(m => m[1])
  .concat([...backendSrc.matchAll(/const marks = (\w+)\.map\(\(\) => '\?'\)/g)].map(m => m[1]));
t.check('every such list is a chunk', lists.length >= 2 && lists.every(n => n === 'chunk'), lists.join(', '));
t.check('and every chunk is cut with D1_IN_CHUNK', (backendSrc.match(/\.slice\(i, i \+ D1_IN_CHUNK\)/g) || []).length >= 2
  && !/\.slice\(i, i \+ 200\)/.test(backendSrc));

t.done();
