// Fixed monthly costs only count in the months they were actually paid.
//
// recurring_expenses had no dates, so every row applied to every month there
// has ever been. A restaurant that signed up in June and entered $9,670 of
// rent, insurance, bookkeeping and licences saw January 2026 — before any
// sales, any invoice, any staff — report "Net profit — what you keep:
// -$9,670", and Year to Date quietly carried $28,918 of costs against no sales
// at all: $180,292.61 of real profit shown as $151,374.16.
//
// The compatibility rule is the important one and is tested hardest: a row with
// no dates must behave EXACTLY as it did before dates existed. Nobody's numbers
// may move because migration 0046 ran.
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const fe = loadBrowserModule(
  ['pnl.js'],
  ['recurringActiveIn', 'recurringMonthsNote', 'monthsInRange'],
);
const t = suite('recurring-months');

// The total a period carries, the way render() computes it.
const totalOver = (rows, from, to) =>
  fe.monthsInRange(from, to).reduce((sum, m) =>
    sum + rows.filter(r => fe.recurringActiveIn(r, m))
               .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0), 0);

// ── Nothing may move for anyone who never touches the new boxes ──
t.section('an undated cost still means every month, forever');

const UNDATED = { name: 'Rent', amount: 8500 };
t.check('applies in the far past',   fe.recurringActiveIn(UNDATED, '2019-01') === true);
t.check('applies this month',        fe.recurringActiveIn(UNDATED, '2026-08') === true);
t.check('applies in the far future', fe.recurringActiveIn(UNDATED, '2099-12') === true);
t.check('null dates behave as absent',
  fe.recurringActiveIn({ amount: 1, start_period: null, end_period: null }, '2026-08') === true);
t.check('empty strings behave as absent',
  fe.recurringActiveIn({ amount: 1, start_period: '', end_period: '' }, '2026-08') === true);
t.check('whitespace behaves as absent',
  fe.recurringActiveIn({ amount: 1, start_period: '  ' }, '2020-01') === true);

// The exact figure from the test report: $9,670/month over 6 months.
const OLD_SET = [
  { name: 'Rent',        amount: 8500 },
  { name: 'Insurance',   amount: 625  },
  { name: 'Bookkeeping', amount: 450  },
  { name: 'Music licence', amount: 95 },
];
t.check('the reported six-month total is unchanged at $58,020',
  totalOver(OLD_SET, '2026-03', '2026-08') === 58020,
  `got ${totalOver(OLD_SET, '2026-03', '2026-08')}`);

// ── The bug it fixes ─────────────────────────────────────────────
t.section('a business that opened in June is not charged for January');

const DATED = OLD_SET.map(r => ({ ...r, start_period: '2026-06' }));
t.check('January carries nothing', totalOver(DATED, '2026-01', '2026-01') === 0);
t.check('February carries nothing', totalOver(DATED, '2026-02', '2026-02') === 0);
t.check('June carries a full month', totalOver(DATED, '2026-06', '2026-06') === 9670);
t.check('the month it starts in is included, not skipped',
  fe.recurringActiveIn({ start_period: '2026-06' }, '2026-06') === true);
t.check('Year to Date stops inventing $28,918 of costs',
  totalOver(DATED, '2026-01', '2026-08') === 9670 * 3,
  `got ${totalOver(DATED, '2026-01', '2026-08')}`);

// ── Ending a cost ────────────────────────────────────────────────
t.section('a cost that stopped');

const ENDED = { name: 'Old lease', amount: 7000, end_period: '2026-05' };
t.check('the last month is included, not cut off',
  fe.recurringActiveIn(ENDED, '2026-05') === true);
t.check('the month after is excluded', fe.recurringActiveIn(ENDED, '2026-06') === false);
t.check('and everything before it is still charged',
  fe.recurringActiveIn(ENDED, '2020-01') === true);

// A rent increase is the old row ended and a new one started. The pair must
// never both charge the same month, and never leave a month uncovered.
t.section('a rent increase mid-period');
const RISE = [
  { name: 'Rent', amount: 8500, end_period:   '2026-05' },
  { name: 'Rent', amount: 9200, start_period: '2026-06' },
];
for (const m of fe.monthsInRange('2026-01', '2026-12')) {
  const hits = RISE.filter(r => fe.recurringActiveIn(r, m));
  t.check(`${m} is covered exactly once`, hits.length === 1, `${hits.length} rows matched`);
}
t.check('March is charged the old rent', totalOver(RISE, '2026-03', '2026-03') === 8500);
t.check('July is charged the new rent',  totalOver(RISE, '2026-07', '2026-07') === 9200);
t.check('a year spans both correctly',
  totalOver(RISE, '2026-01', '2026-12') === 8500 * 5 + 9200 * 7,
  `got ${totalOver(RISE, '2026-01', '2026-12')}`);

// ── Both bounds ──────────────────────────────────────────────────
t.section('a cost with a start and an end');

const WINDOW = { amount: 100, start_period: '2026-04', end_period: '2026-06' };
const inWindow = fe.monthsInRange('2026-01', '2026-12').filter(m => fe.recurringActiveIn(WINDOW, m));
t.check('exactly three months match', inWindow.length === 3, inWindow.join(','));
t.check('and they are the right three',
  inWindow.join(',') === '2026-04,2026-05,2026-06', inWindow.join(','));
t.check('a single-month window works',
  fe.monthsInRange('2026-01', '2026-12')
    .filter(m => fe.recurringActiveIn({ start_period: '2026-04', end_period: '2026-04' }, m))
    .join(',') === '2026-04');

// ── Year boundaries, where a string compare could go wrong ───────
t.section('across a year end');

const XMAS = { amount: 1, start_period: '2025-11', end_period: '2026-02' };
t.check('December 2025 is in',  fe.recurringActiveIn(XMAS, '2025-12') === true);
t.check('January 2026 is in',   fe.recurringActiveIn(XMAS, '2026-01') === true);
t.check('October 2025 is out',  fe.recurringActiveIn(XMAS, '2025-10') === false);
t.check('March 2026 is out',    fe.recurringActiveIn(XMAS, '2026-03') === false);
// '2026-9' would sort after '2026-10' — the padding is what makes this safe.
t.check('a padded month sorts correctly against a two-digit one',
  fe.recurringActiveIn({ start_period: '2026-09' }, '2026-10') === true);

// ── The note beside each row's date boxes ────────────────────────
// It must never repeat the dates — the two inputs are showing them — and must
// say the one thing the boxes cannot: did this row reach the period on screen.
t.section('the note beside a fixed cost');

const note = (row, months, n, single) => fe.recurringMonthsNote(row, months, n, single);

t.check('an undated row says it applies every month',
  note({}, 6, 6, false) === 'every month');
t.check('a dated row covering the whole period says nothing extra',
  note({ start_period: '2020-01' }, 6, 6, false) === '');
t.check('a dated row covering part of it says how much',
  note({ start_period: '2026-06' }, 3, 8, false) === 'counted in 3 of 8 months');

// The row is on screen with a real amount but adds nothing to the total. Left
// unexplained it reads as a broken sum or a cost someone forgot to enter.
t.check('a row outside the period says so, not nothing',
  note({ start_period: '2026-06' }, 0, 8, false) === 'not paid in this period');
t.check('and phrases it for a single month',
  note({ start_period: '2026-06' }, 0, 1, true) === 'not paid this month');

t.check('a single-month view of an active dated row stays quiet',
  note({ start_period: '2026-06' }, 1, 1, true) === '');
t.check('an end date alone still counts as dated',
  note({ end_period: '2026-09' }, 1, 1, true) === '');
t.check('blank strings are not treated as dates',
  note({ start_period: '', end_period: '  ' }, 6, 6, false) === 'every month');

t.done();
