// The Home strip's profit comes from monthProfitSummary() in utils.js: the P&L
// page's sum written once. The P&L page still does its own (pnl.js render), so
// this file holds the two together: the shared pieces must give what pnl.js's
// own give, and the Home page must not grow a private sum again.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = suite('month-profit');

const { monthProfitSummary, monthProfitShare, monthProfitFixedRuns, spreadAllocation, recurringActiveIn } =
  loadBrowserModule(['utils.js', 'pnl.js'],
    ['monthProfitSummary', 'monthProfitShare', 'monthProfitFixedRuns', 'spreadAllocation', 'recurringActiveIn']);

// ── the pieces agree with the P&L page's own ───────────────────
t.section('shares by days — same as the P&L page');
const bills = [
  { start_date: '2026-09-20', end_date: '2026-10-05', total_amount: 1600 },   // straddles a month end
  { start_date: '2026-10-01', end_date: '2026-10-31', total_amount: 310 },    // exactly the month
  { start_date: '2025-11-15', end_date: '2027-02-14', total_amount: 9999.99 },// crosses two year ends
  { start_date: '2026-11-01', end_date: '2026-11-30', total_amount: 500 },    // next month only
  { start_date: '2026-10-10', end_date: '2026-10-09', total_amount: 500 },    // ends before it starts
  { start_date: '', end_date: '2026-10-09', total_amount: 500 },              // no start
  { start_date: '2028-02-01', end_date: '2028-02-29', total_amount: 290 },    // leap February
];
for (const m of ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2028-02']) {
  for (const b of bills) {
    const mine = monthProfitShare(b, m), theirs = spreadAllocation(b, m).allocated;
    t.check(`${b.start_date || '(none)'}..${b.end_date} in ${m}`, Math.abs(mine - theirs) < 1e-9, `${mine} vs ${theirs}`);
  }
}

t.section('fixed costs by month — same as the P&L page');
const fixed = [
  {}, { start_period: '2026-10' }, { end_period: '2026-09' }, { start_period: '2026-11' },
  { start_period: '2026-08', end_period: '2026-10' }, { start_period: ' ', end_period: '' },
];
for (const m of ['2026-09', '2026-10', '2026-11']) {
  for (const f of fixed) {
    t.check(`${JSON.stringify(f)} in ${m}`, monthProfitFixedRuns(f, m) === recurringActiveIn(f, m));
  }
}
t.check('a switched-off fixed cost never runs', monthProfitFixedRuns({ active: 0 }, '2026-10') === false);
t.check('active = 1 runs', monthProfitFixedRuns({ active: 1 }, '2026-10') === true);

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

// ── the Home page keeps no private sum ─────────────────────────
t.section('the Home strip uses the shared sum');
const home = readFileSync(join(ROOT, 'public', 'static', 'home.js'), 'utf8');
t.check('home.js calls monthProfitSummary', /monthProfitSummary\(/.test(home));
t.check('and no longer adds the costs up itself', !/costs\.food_cost|purchase_pst|sales_total/.test(home));
const homeHtml = readFileSync(join(ROOT, 'public', 'home.html'), 'utf8');
t.check('utils.js is loaded before home.js',
  homeHtml.indexOf('/static/utils.js') > 0 && homeHtml.indexOf('/static/utils.js') < homeHtml.indexOf('/static/home.js'));

t.done();
