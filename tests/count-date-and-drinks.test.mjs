// Two P&L fixes from the October run on Pro Test Account (2026-10-06).
//
// 1. A stock count belongs to the day on the restaurant's own clock. The P&L
//    used the UTC day of submitted_at, so an evening count on 30 September in
//    Vancouver (already 1 October in UTC) opened no month at all.
// 2. A till sale is a drink when its category says so. Only an exact match with
//    one of the account's own category names counted, so "Drinks", "Beer" and
//    "Wine" were all food.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');
const page = readFileSync(join(ROOT, 'public/static/stock-take.js'), 'utf8');
const mig  = readFileSync(join(ROOT, 'migrations/0062_stock_take_count_date.sql'), 'utf8');
const t = suite('count-date-and-drinks');

function extractFn(name) {
  const m = src.match(new RegExp(`^function ${name}\\s*\\([\\s\\S]*?^\\}`, 'm'));
  if (!m) throw new Error(`could not find ${name}() in src/index.ts`);
  const b = m[0];
  const open = b.indexOf('('), brace = b.search(/\{\s*\n/), close = b.lastIndexOf(')', brace);
  const params = b.slice(open + 1, close).split(',').map(p => p.split(':')[0].trim()).filter(Boolean);
  return `function ${name}(${params.join(', ')}) ${b.slice(brace)}`;
}
const words = src.match(/^const DRINK_WORDS = .*$/m);
const { localCountDate, isDrinkSale } = new Function(
  [words[0], extractFn('localCountDate'), extractFn('isDrinkSale'), 'return { localCountDate, isDrinkSale };'].join('\n'))();

t.section('the count date the browser sends');
const NOW = '2026-10-01T04:00:00.000Z';   // 30 Sep, 9 pm in Vancouver
t.check('the evening before in UTC terms is believed', localCountDate('2026-09-30', NOW) === '2026-09-30');
t.check('the same day is believed', localCountDate('2026-10-01', NOW) === '2026-10-01');
t.check('a day ahead (Japan, late UTC evening) is believed', localCountDate('2026-10-02', NOW) === '2026-10-02');
t.check('two days off is a wrong clock, dropped', localCountDate('2026-09-29', NOW) === null && localCountDate('2026-10-03', NOW) === null);
t.check('a date that does not exist is dropped', localCountDate('2026-09-31', NOW) === null);
t.check('anything not shaped like a date is dropped',
  localCountDate('30/09/2026', NOW) === null && localCountDate('', NOW) === null && localCountDate(undefined, NOW) === null
  && localCountDate('2026-09-30T00:00', NOW) === null);

t.section('the count date is saved and used');
t.check('the column exists and starts empty', /ALTER TABLE stock_takes ADD COLUMN count_date TEXT DEFAULT NULL/.test(mig));
t.check('submit writes it through the check', /count_date = \?[\s\S]{0,120}localCountDate\(body\.count_date, now\)/.test(src));
const pnlTakes = src.slice(src.indexOf('const closingTake = await'), src.indexOf('const { valueTake } = valuer'));
t.check('the P&L picks both counts by it, falling back to the UTC day',
  (pnlTakes.match(/COALESCE\(count_date, date\(submitted_at\)\) AS d/g) || []).length === 2
  && /COALESCE\(count_date, date\(submitted_at\)\) <= \?/.test(pnlTakes)
  && /COALESCE\(count_date, date\(submitted_at\)\) < \?/.test(pnlTakes));
t.check('no bare UTC-day comparison is left there', !/AND date\(submitted_at\) <=? \?/.test(pnlTakes));
t.check('the page sends its own clock\'s day, with dashes',
  /count_date: todayYMD\(\)\.replace\(\/\\\/\/g, '-'\)/.test(page));

t.section('which till sales are drinks');
for (const c of ['Drinks', 'drinks', 'Soft Drinks', 'Beverages', 'Beer', 'Draft Beers', 'Wine', 'Red Wine', 'Cocktails',
  'Spirits', 'Coffee', 'Hot Tea', 'Juice', 'Sodas', 'Beer & Wine']) {
  t.check(`"${c}" is drinks`, isDrinkSale(null, c) === true);
}
for (const c of ['Food', 'Pizza', 'Pasta', 'Steak', 'Desserts', 'Winery Platter', 'Teapot Cake', 'Beerenberg Jam', 'Sodastream', '', null]) {
  t.check(`"${c}" is food`, isDrinkSale(null, c) === false);
}
t.check('one of the account\'s own drink categories still counts', isDrinkSale('beverage', 'Alcohol') === true);
t.check('one of its own food categories wins over a drink word in its name', isDrinkSale('food', 'Coffee Cake') === false);
t.check('supplies are not drinks', isDrinkSale('supplies', 'Tea Towels') === false);

t.section('the P&L uses it');
const sales = src.slice(src.indexOf('const impRows = await'), src.indexOf('return c.json({\n    from,'));
t.check('sales are grouped by till category, then classified', /GROUP BY period, l\.pos_category, cat\.type/.test(sales)
  && /isDrinkSale\(r\.cat_type, r\.pos_category\)/.test(sales));
t.check('a month\'s categories are added together, not overwritten', /\?\?= \{ imported_net: 0/.test(sales) && /m\.imported_net\s+\+= net/.test(sales));
t.check('still only this organization\'s lines', /l\.org_id IS \?/.test(sales) && /i\.org_id IS \?/.test(sales) && /cat\.org_id IS \?/.test(sales));

t.done();
