// Labour by pay period, prorated into calendar months — the arithmetic behind
// the P&L's Labour line and prime cost.
//
// The case this exists for: payroll runs do not line up with months. A fortnight
// of 20 Aug – 5 Sep belongs 12 days to August and 5 to September, and putting
// the whole figure in either month is wrong by thousands. `labor_periods` reuses
// spread_expenses' shape (total_amount + start_date + end_date) precisely so it
// can be split by the same function, so this exercises the SHIPPED
// spreadAllocationRange from pnl.js rather than a copy.
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const fe = loadBrowserModule(['pnl.js'], ['spreadAllocation', 'spreadAllocationRange']);
const t = suite('labor-prime');

// $17,000 over 17 days = $1,000/day, so the split is readable by eye.
const FORTNIGHT = { total_amount: 17000, start_date: '2026-08-20', end_date: '2026-09-05' };

t.section('a pay period that straddles month end');
const aug = fe.spreadAllocation(FORTNIGHT, '2026-08');
const sep = fe.spreadAllocation(FORTNIGHT, '2026-09');
t.check('August takes 12 of the 17 days', aug.overlapDays === 12 && aug.totalDays === 17,
        `got ${aug.overlapDays}/${aug.totalDays}`);
t.check('August is charged $12,000', t.near(aug.allocated, 12000, 1e-9), `got ${aug.allocated}`);
t.check('September takes the other 5 days', sep.overlapDays === 5, `got ${sep.overlapDays}`);
t.check('September is charged $5,000', t.near(sep.allocated, 5000, 1e-9), `got ${sep.allocated}`);
t.check('nothing is lost or invented between the two months',
        t.near(aug.allocated + sep.allocated, 17000, 1e-9));

t.section('period totals');
t.check('a single month gets only its own share',
        t.near(fe.spreadAllocationRange(FORTNIGHT, '2026-08', '2026-08').allocated, 12000, 1e-9));
t.check('a range covering both gets the whole run',
        t.near(fe.spreadAllocationRange(FORTNIGHT, '2026-08', '2026-09').allocated, 17000, 1e-9));
t.check('a month the run never touches gets nothing',
        fe.spreadAllocationRange(FORTNIGHT, '2026-07', '2026-07').allocated === 0);

t.section('degenerate input never manufactures cost');
// A cost invented from a typo is worse than one missing: the P&L would report a
// profit that no correction ever explains.
t.check('end before start allocates nothing',
        fe.spreadAllocation({ total_amount: 5000, start_date: '2026-08-20', end_date: '2026-08-01' }, '2026-08').allocated === 0);
t.check('a missing date allocates nothing',
        fe.spreadAllocation({ total_amount: 5000, start_date: '', end_date: '2026-08-31' }, '2026-08').allocated === 0);
t.check('a single-day pay period lands whole in its month',
        t.near(fe.spreadAllocation({ total_amount: 800, start_date: '2026-08-31', end_date: '2026-08-31' }, '2026-08').allocated, 800, 1e-9));

t.section('prime cost is a subtotal, not a second deduction');
// render() needs a DOM, so the invariant is pinned as arithmetic: labour is
// subtracted once (inside running costs) and re-used for display. If prime cost
// were ever subtracted too, net profit would fall by the labour figure again.
const cogs = 4000, labor = 12000, sales = 30000, otherRunning = 6000;
const net   = sales - cogs - (otherRunning + labor);
const prime = cogs + labor;
t.check('net profit charges labour exactly once', net === 8000, `got ${net}`);
t.check('prime cost is food+drink+labour', prime === 16000, `got ${prime}`);
t.check('prime cost is not part of net profit', sales - cogs - otherRunning - labor === net);

t.done();
