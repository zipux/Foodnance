// The P&L's exact-dates view (Pro): a week between two stock counts, or any two
// dates. These are the page's own sums — a pay period's share of the days, the
// days wages cover, and the "Between counts" list — plus the wiring that keeps
// the whole-month statement exactly as it was.
import { readFileSync } from 'node:fs';
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const t = suite('pnl-exact-dates');
const fe = loadBrowserModule(['pnl.js'], ['dayAllocation', 'daysWithWages', 'countPeriods', 'spreadAllocation']);
const js   = readFileSync(new URL('../public/static/pnl.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/pnl.html', import.meta.url), 'utf8');
const src  = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

t.section('a pay period\'s share of the days');
const pay = { total_amount: 1400, start_date: '2026-09-01', end_date: '2026-09-14' };   // $100 a day
const w1 = fe.dayAllocation(pay, '2026-09-07', '2026-09-13');
t.check('a week inside it: 7 of 14 days = $700', t.near(w1.allocated, 700) && w1.overlapDays === 7 && w1.totalDays === 14, JSON.stringify(w1));
const w2 = fe.dayAllocation(pay, '2026-09-14', '2026-09-20');
t.check('a week that only touches its last day: $100', t.near(w2.allocated, 100) && w2.overlapDays === 1, JSON.stringify(w2));
t.check('a week outside it: nothing', fe.dayAllocation(pay, '2026-09-21', '2026-09-27').allocated === 0);
t.check('a pay period with its dates the wrong way round: nothing',
  fe.dayAllocation({ total_amount: 100, start_date: '2026-09-10', end_date: '2026-09-01' }, '2026-09-01', '2026-09-30').allocated === 0);
const sep = fe.dayAllocation(pay, '2026-09-01', '2026-09-30');
t.check('over a whole month it equals the monthly sum', t.near(sep.allocated, fe.spreadAllocation(pay, '2026-09').allocated), JSON.stringify(sep));

t.section('days that have wages');
t.check('all 7', fe.daysWithWages([pay], '2026-09-07', '2026-09-13') === 7);
t.check('1 of 7', fe.daysWithWages([pay], '2026-09-14', '2026-09-20') === 1);
t.check('none entered', fe.daysWithWages([], '2026-09-07', '2026-09-13') === 0);
t.check('two pay periods that overlap do not count a day twice',
  fe.daysWithWages([pay, { total_amount: 1, start_date: '2026-09-10', end_date: '2026-09-16' }], '2026-09-10', '2026-09-20') === 7);

t.section('the "Between counts" list');
const list = fe.countPeriods(['2026-09-14', '2026-09-07', '2026-09-21', '2026-09-14']);
t.check('one entry per pair of neighbouring counts, newest first', list.length === 2 && list[0].from === '2026-09-14' && list[1].from === '2026-09-07', JSON.stringify(list));
t.check('a count is before opening: the period ends the day before the next count',
  list[1].to === '2026-09-13' && list[0].to === '2026-09-20', JSON.stringify(list));
t.check('the label names the two count days', /7 Sep 2026/.test(list[1].label) && /14 Sep 2026/.test(list[1].label), list[1].label);
t.check('one count alone gives nothing to choose', fe.countPeriods(['2026-09-07']).length === 0);

t.section('the whole-month statement is left as it was');
const days = js.slice(js.indexOf('function renderDays'), js.indexOf('// ── Net sales (upsert'));
t.check('the short view has no rent, one-off, supplies or net profit line',
  !/pnlRecurring|pnlOverheads|pnlSpread|supplies_cost|Net profit|Gross profit/.test(days));
t.check('it never uses a month\'s typed sales', !/pnlSalesRows|sales_total|pnlSaveSales/.test(days));
t.check('no sales imported: said, and no percentages', /No sales imported for these dates/.test(days) && /hasSales \? Math\.round/.test(days));
t.check('missing wages are said, not shown as $0', /Wages are not entered for these dates/.test(days) && /wageRows\.length \? fmtMoney\(wages\) : '—'/.test(days));
t.check('a month range leaves the short view', /function pnlSetRange[\s\S]{0,160}pnlClearDays\(\)/.test(js));
t.check('the row is hidden until the plan is known to be Pro', /class="pnl-period-sec hidden" id="pnlDatesBar"/.test(html)
  && /bar\.classList\.toggle\('hidden', !pro\)/.test(js));
t.check('the month boxes are still month boxes', /<input type="month" id="pnlFrom" \/>/.test(html) && /<input type="month" id="pnlTo" \/>/.test(html));

t.section('the server');
const pnl = src.slice(src.indexOf("app.get('/api/pnl', async"), src.indexOf('export default app'));
t.check('exact dates need BOTH ends as real days', /const byDay = isRealDay\(from\) && isRealDay\(to\)/.test(pnl));
t.check('one count rule for months and dates: a count is before opening', /const openBefore = shiftDay\(periodStart, 1\)/.test(pnl)
  && /const closeLimit = shiftDay\(periodEnd, 1\)/.test(pnl) && /closingTake\.d > periodStart/.test(pnl));
t.check('only full counts are offered between', /app\.get\('\/api\/pnl\/count-days'[\s\S]{0,400}kind = 'full'[\s\S]{0,60}org_id IS \?/.test(src));

t.section('a count that is not on the edge of the period');
t.check('the estimate needs the till sales for those days, and fails soft', /if \(!await salesCover\(c\.env\.DB, org, a, b\)\) return \{ value, estimate: null, gap: \{ from: a, to: b \} \}/.test(pnl)
  && /catch \(e\) \{ console\.error\('count carry-forward failed'/.test(pnl));
t.check('a count on the edge is left alone', /if \(take\.d >= edge\) return \{ value, estimate: null, gap: null \}/.test(pnl));
t.check('both ends by the same rule, so months chain', /open  = await carry\(openingTake!, opening, periodStart\)/.test(pnl)
  && /close = await carry\(closingTake!, closing, shiftDay\(periodEnd, 1\)\)/.test(pnl));
const used = src.slice(src.indexOf('async function stockUsedBetween'), src.indexOf('// A real calendar day'));
t.check('used = un-voided sales imports and hand-recorded waste, never count lines',
  /i\.status = 'Closed' AND i\.voided_at IS NULL/.test(used) && /COALESCE\(l\.stock_take_id, ''\) = ''/.test(used) && /Object\.keys\(WASTE_REASONS\)/.test(used));
const note = js.slice(js.indexOf('function pnlCarryNote'), js.indexOf('// The row is for Pro'));
t.check('the page says "estimated", from which count, and what it cannot see',
  /<strong>estimated<\/strong> from your/.test(note) && /Stock lost with no record is not in an estimate/.test(note));
t.check('and says when it could not estimate', /the till sales for those days are not imported/.test(note));
t.check('both statements carry the note', (js.match(/\$\{pnlCarryNote\(cogsData\)\}/g) || []).length === 2);

t.section('taxes: PST is a cost, GST/HST is not');
t.check('PST comes from supplier invoices only, closed and not voided', /SUM\(COALESCE\(tax_pst, 0\)\) AS pst[\s\S]{0,160}status = 'Closed' AND voided_at IS NULL[\s\S]{0,80}COALESCE\(invoice_kind, ''\) != 'expense'/.test(pnl));
t.check('an expense bill is counted less its GST, never below zero', /SUM\(COALESCE\(total, 0\) - MIN\(MAX\(COALESCE\(tax_gst, 0\), 0\), MAX\(COALESCE\(total, 0\), 0\)\)\) AS amount/.test(pnl));
t.check('the page adds PST to the running costs once', /const running = supplies \+ fees \+ pst \+ expenseInvTotal/.test(js) && (js.match(/costRow\('Provincial sales tax \(PST\)'/g) || []).length === 1);
const homeJs = readFileSync(new URL('../public/static/home.js', import.meta.url), 'utf8');
t.check('the Home tile counts it too, so the two profits agree', /\+ \(parseFloat\(costs\.purchase_pst\) \|\| 0\)/.test(homeJs));
const invJs = readFileSync(new URL('../public/static/invoices.js', import.meta.url), 'utf8');
t.check('the expense bill shows its GST and saves it', /id="detailExpenseGst"/.test(readFileSync(new URL('../public/invoices.html', import.meta.url), 'utf8'))
  && /tax_gst:          gst,/.test(invJs) && /if \(gst < 0 \|\| gst >= total\)/.test(invJs));

t.done();
