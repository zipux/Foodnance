// The P&L arithmetic is written once: periodProfitSummary() in utils.js. The
// P&L page (pnl.js render) draws it and the Home strip (home.js) shows one
// month of it. This file checks the sum itself and that neither page grows a
// private copy again.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = suite('month-profit');

const { monthProfitSummary, periodProfitSummary, monthProfitAllocation, monthProfitFixedDated,
        spreadAllocation, spreadAllocationRange, recurringActiveIn } =
  loadBrowserModule(['utils.js', 'pnl.js'],
    ['monthProfitSummary', 'periodProfitSummary', 'monthProfitAllocation', 'monthProfitFixedDated',
     'spreadAllocation', 'spreadAllocationRange', 'recurringActiveIn']);

// ── shares by days ─────────────────────────────────────────────
t.section('a bill is shared by days');
const share = (row, m) => monthProfitAllocation(row, m).allocated;
const straddle = { start_date: '2026-09-20', end_date: '2026-10-05', total_amount: 1600 };   // 16 days
t.check('11 of 16 days in September', t.near(share(straddle, '2026-09'), 1100));
t.check('5 of 16 days in October', t.near(share(straddle, '2026-10'), 500));
t.check('nothing in November', share(straddle, '2026-11') === 0);
t.check('a bill for exactly the month is whole', t.near(share({ start_date: '2026-10-01', end_date: '2026-10-31', total_amount: 310 }, '2026-10'), 310));
t.check('leap February is 29 days', monthProfitAllocation({ start_date: '2028-02-01', end_date: '2028-02-29', total_amount: 290 }, '2028-02').overlapDays === 29);
t.check('ends before it starts: nothing', share({ start_date: '2026-10-10', end_date: '2026-10-09', total_amount: 500 }, '2026-10') === 0);
t.check('no start date: nothing', share({ start_date: '', end_date: '2026-10-09', total_amount: 500 }, '2026-10') === 0);
const long = { start_date: '2025-11-15', end_date: '2027-02-14', total_amount: 9999.99 };
const months16 = []; for (let y = 2025, m = 11; !(y === 2027 && m === 3); m === 12 ? (y++, m = 1) : m++) months16.push(`${y}-${String(m).padStart(2, '0')}`);
t.check('across two year ends the shares add back to the bill',
  t.near(months16.reduce((s, m) => s + share(long, m), 0), 9999.99, 1e-6));
t.check('the P&L page\'s own names are the same functions',
  spreadAllocation(straddle, '2026-09').allocated === share(straddle, '2026-09')
  && spreadAllocationRange(straddle, '2026-09', '2026-10').allocated === share(straddle, '2026-09') + share(straddle, '2026-10'));

t.section('a fixed cost runs only in its months');
t.check('no dates: every month', monthProfitFixedDated({}, '2026-10') === true);
t.check('starts next month: not yet', monthProfitFixedDated({ start_period: '2026-11' }, '2026-10') === false);
t.check('ended last month: no longer', monthProfitFixedDated({ end_period: '2026-09' }, '2026-10') === false);
t.check('both ends are inclusive', monthProfitFixedDated({ start_period: '2026-10', end_period: '2026-10' }, '2026-10') === true);
t.check('the P&L page\'s own name is the same function', recurringActiveIn({ end_period: '2026-09' }, '2026-10') === false && recurringActiveIn({}, '2026-10') === true);

// ── the sum ─────────────────────────────────────────────────────
t.section('the month sum');
const costs = {
  food_cost: 1000, beverage_cost: 200, supplies_cost: 50, invoice_fees: 18, purchase_pst: 7,
  expense_invoices: [{ amount: 300 }, { amount: 100.5 }],
  sales: { by_month: { '2026-10': { imported_net: 14025 } } },
  cogs: { available: true, food_cogs: 900, beverage_cogs: 250 },
};
const d = {
  costs,
  sales_rows: [{ period: '2026-10', sales_total: 5000, revenue_source: 'auto' }],
  one_offs: [{ period: '2026-10', amount: 40 }, { period: '2026-09', amount: 999 }],
  fixed: [{ amount: 6500 }, { amount: 380, end_period: '2026-09' }, { amount: 70, active: 0 }],
  spread: [{ start_date: '2026-10-01', end_date: '2026-11-30', total_amount: 610 }],   // 31 of 61 days
  labor: [{ start_date: '2026-09-28', end_date: '2026-10-11', total_amount: 1400 }],   // 11 of 14 days
};
const running = 50 + 18 + 7 + 400.5 + 6500 + 310 + 40 + 1100;
const bought = monthProfitSummary('2026-10', d, 'purchases');
t.check('imported till sales win', bought.sales === 14025 && bought.sales_source === 'pos', JSON.stringify(bought));
t.check('bought: costs', t.near(bought.costs, 1200 + running), `${bought.costs}`);
t.check('bought: profit', t.near(bought.profit, 14025 - 1200 - running), `${bought.profit}`);
t.check('a fixed cost that ended last month is left out', t.near(bought.running, running), `${bought.running}`);
const used = monthProfitSummary('2026-10', d, 'cogs');
t.check('used: food and drinks from the counts', used.basis === 'cogs' && used.food === 900 && used.beverage === 250);
t.check('used: profit', t.near(used.profit, 14025 - 1150 - running), `${used.profit}`);

const noCounts = monthProfitSummary('2026-10', { ...d, costs: { ...costs, cogs: { available: false } } }, 'cogs');
t.check('"used" with no counts falls back to bought', noCounts.basis === 'purchases' && noCounts.food === 1000);

const typedWins = monthProfitSummary('2026-10',
  { ...d, sales_rows: [{ period: '2026-10', sales_total: 5000, revenue_source: 'manual' }] }, 'purchases');
t.check('a month set to the typed figure uses it', typedWins.sales === 5000 && typedWins.sales_source === 'manual');

const noImport = monthProfitSummary('2026-10', { ...d, costs: { ...costs, sales: { by_month: {} } } }, 'purchases');
t.check('no import: the typed figure', noImport.sales === 5000);

const empty = monthProfitSummary('2026-10', {}, 'purchases');
t.check('an empty account is all zeros, no sales', empty.costs === 0 && empty.sales === 0 && empty.has_sales === false);

// ── a period of several months ─────────────────────────────────
t.section('a period of several months');
const two = periodProfitSummary(['2026-09', '2026-10'], d, 'purchases');
t.check('a fixed cost counts once per month it runs: rent twice, the ended insurance once',
  t.near(two.fixedTotal, 6500 * 2 + 380), `${two.fixedTotal}`);
t.check('a switched-off fixed cost is never counted', two.fixedAlloc.length === 2);
t.check('one-offs of both months', t.near(two.ohTotal, 40 + 999), `${two.ohTotal}`);
t.check('the pay period is whole across both months', t.near(two.laborTotal, 1400), `${two.laborTotal}`);
t.check('September has no sales and is named as missing', two.missingSales.join() === '2026-09', two.missingSales.join());
t.check('net = sales - food and drinks - running costs', t.near(two.net, two.sales - two.cogsTotal - two.running));
t.check('prime cost = food + drinks + wages', t.near(two.prime, two.cogsTotal + two.laborTotal));

// ── neither page keeps a private sum ───────────────────────────
t.section('one copy of the sum');
const home = readFileSync(join(ROOT, 'public', 'static', 'home.js'), 'utf8');
const pnl  = readFileSync(join(ROOT, 'public', 'static', 'pnl.js'), 'utf8');
t.check('home.js calls monthProfitSummary', /monthProfitSummary\(/.test(home));
t.check('and does not add the costs up itself', !/costs\.food_cost|purchase_pst|sales_total/.test(home));
const renderSrc = pnl.slice(pnl.indexOf('function render() {'), pnl.indexOf('function _ymdOfDayNum'));
t.check('the P&L page asks periodProfitSummary', /periodProfitSummary\(months,/.test(renderSrc));
t.check('and does not add the costs up itself',
  !/const (running|net|gross|cogsTotal|fixedTotal|spreadTotal|laborTotal|ohTotal)\s*=/.test(renderSrc)
  && !/pnlCosts\.(food_cost|beverage_cost|supplies_cost|invoice_fees|purchase_pst)/.test(renderSrc));
for (const page of ['home.html', 'pnl.html']) {
  const html = readFileSync(join(ROOT, 'public', page), 'utf8');
  const own = page === 'home.html' ? '/static/home.js' : '/static/pnl.js';
  t.check(`${page} loads utils.js before its own script`,
    html.indexOf('/static/utils.js') > 0 && html.indexOf('/static/utils.js') < html.indexOf(own));
}

t.done();
