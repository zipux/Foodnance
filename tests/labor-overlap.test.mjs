// The duplicate-pay-period warning.
//
// Payroll is the most repetitive entry on the P&L — 26 times a year, always the
// same shape — and it is the biggest number on the page, so entering one twice
// does more damage than a duplicate anywhere else. A repeated August fortnight
// took $23,800 off the month's profit and dragged prime cost from 68% to 82%,
// with nothing on screen to explain it.
//
// The check must WARN, not block: two rows covering one fortnight is a
// legitimate way to split kitchen from front of house. So this file spends most
// of its weight on the pairs that must stay SILENT — a warning that fires on
// correct input teaches people to click past it, and then it cannot do its job
// on the day it matters.
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const fe = loadBrowserModule(
  ['pnl.js'],
  ['pnlOverlappingLabor', 'pnlLaborClashNote', '_isSameLaborRun', 'pnlLabor'],
);
const t = suite('labor-overlap');

// pnlLabor is the page's own cache of every pay period on file. Tests push into
// the real array so they exercise the shipped lookup rather than a stand-in.
const seed = (rows) => { fe.pnlLabor.length = 0; fe.pnlLabor.push(...rows); };

const FORTNIGHT = {
  id: 'aug1', name: 'Fortnight 16', total_amount: 24600,
  start_date: '2026-08-09', end_date: '2026-08-22',
};

// ── The case this exists for ─────────────────────────────────────
t.section('the same fortnight entered twice');

seed([FORTNIGHT]);
const exact = fe.pnlLaborClashNote('2026-08-09', '2026-08-22', 24600, '');
t.check('an identical pay period is caught', exact !== null);
t.check('and is called out as identical, not merely overlapping',
  /identical/i.test(exact || ''), exact);
t.check('the note names the row it clashes with', /Fortnight 16/.test(exact || ''), exact);
t.check('and its dates and amount, so it can be told apart',
  /9 Aug 2026/.test(exact || '') && /\$24600\.00|\$24,600\.00/.test(exact || ''), exact);

// Same dates, different money — someone correcting a figure, or a genuine split.
// Still worth flagging, but it is not a duplicate.
const sameDatesDifferentMoney = fe.pnlLaborClashNote('2026-08-09', '2026-08-22', 9800, '');
t.check('same dates but a different amount still warns', sameDatesDifferentMoney !== null);
t.check('but is NOT described as identical',
  !/identical/i.test(sameDatesDifferentMoney || ''), sameDatesDifferentMoney);
t.check('and it says why an overlap can be legitimate',
  /kitchen|front of house|splitting/i.test(sameDatesDifferentMoney || ''), sameDatesDifferentMoney);

// ── What must stay silent ────────────────────────────────────────
t.section('ordinary consecutive payroll never warns');

// A year of biweekly runs, back to back, Sunday to Saturday. Not one of these
// may warn about the one before it — this is what normal use looks like.
const runs = [];
for (let i = 0; i < 26; i++) {
  const start = new Date(Date.UTC(2026, 0, 4 + i * 14));
  const end   = new Date(Date.UTC(2026, 0, 4 + i * 14 + 13));
  const ymd   = d => d.toISOString().slice(0, 10);
  runs.push({ id: `r${i}`, total_amount: 20000, start_date: ymd(start), end_date: ymd(end) });
}
let noisy = 0;
for (let i = 0; i < runs.length; i++) {
  seed(runs.filter((_, j) => j !== i));
  if (fe.pnlLaborClashNote(runs[i].start_date, runs[i].end_date, runs[i].total_amount, '')) noisy++;
}
t.check('26 consecutive fortnights produce no warnings at all', noisy === 0, `${noisy} warned`);

seed([FORTNIGHT]);
t.check('the fortnight immediately after touches nothing',
  fe.pnlLaborClashNote('2026-08-23', '2026-09-05', 22900, '') === null);
t.check('the fortnight immediately before touches nothing',
  fe.pnlLaborClashNote('2026-07-26', '2026-08-08', 24600, '') === null);
t.check('a period ending the day before the existing one starts is silent',
  fe.pnlLaborClashNote('2026-07-27', '2026-08-08', 100, '') === null);
t.check('a period starting the day after it ends is silent',
  fe.pnlLaborClashNote('2026-08-23', '2026-09-01', 100, '') === null);
t.check('a completely unrelated month is silent',
  fe.pnlLaborClashNote('2026-02-01', '2026-02-14', 100, '') === null);

t.section('editing an existing pay period does not warn about itself');
t.check('re-saving the row unchanged is silent',
  fe.pnlLaborClashNote('2026-08-09', '2026-08-22', 24600, 'aug1') === null);
t.check('nudging its end date is still silent',
  fe.pnlLaborClashNote('2026-08-09', '2026-08-23', 24600, 'aug1') === null);
// ...but it must still see OTHER rows while editing.
seed([FORTNIGHT, { id: 'aug2', total_amount: 9000, start_date: '2026-08-15', end_date: '2026-08-28' }]);
t.check('editing one row still warns about a different overlapping row',
  fe.pnlLaborClashNote('2026-08-09', '2026-08-22', 24600, 'aug1') !== null);

// ── Boundaries ───────────────────────────────────────────────────
t.section('every way two ranges can touch');

seed([FORTNIGHT]);   // 9–22 Aug
const cases = [
  ['2026-08-22', '2026-09-04', true,  'starts on the last day of the existing one'],
  ['2026-07-27', '2026-08-09', true,  'ends on the first day of the existing one'],
  ['2026-08-12', '2026-08-15', true,  'sits entirely inside it'],
  ['2026-08-01', '2026-08-31', true,  'entirely contains it'],
  ['2026-08-09', '2026-08-22', true,  'is exactly it'],
  ['2026-08-23', '2026-08-30', false, 'starts the day after it ends'],
  ['2026-08-01', '2026-08-08', false, 'ends the day before it starts'],
];
for (const [s, e, want, why] of cases) {
  const got = fe.pnlLaborClashNote(s, e, 1000, '') !== null;
  t.check(`${want ? 'warns' : 'silent'} — a period that ${why}`, got === want);
}

// ── Odd input must not throw or invent a warning ─────────────────
t.section('missing and malformed dates');

seed([FORTNIGHT, { id: 'broken', total_amount: 5000, start_date: '', end_date: '' }]);
t.check('a stored row with no dates is ignored, not matched',
  fe.pnlOverlappingLabor('2026-08-09', '2026-08-22', '').every(r => r.id !== 'broken'));
t.check('an empty new range warns about nothing',
  fe.pnlLaborClashNote('', '', 1000, '') === null);
t.check('a junk new range warns about nothing',
  fe.pnlLaborClashNote('not-a-date', 'nonsense', 1000, '') === null);

seed([]);
t.check('the first pay period ever entered is silent',
  fe.pnlLaborClashNote('2026-08-09', '2026-08-22', 24600, '') === null);

// ── Counting ─────────────────────────────────────────────────────
t.section('several clashes at once');

seed([
  FORTNIGHT,
  { id: 'b', total_amount: 1000, start_date: '2026-08-10', end_date: '2026-08-12' },
  { id: 'c', total_amount: 1000, start_date: '2026-08-20', end_date: '2026-08-25' },
]);
const many = fe.pnlLaborClashNote('2026-08-09', '2026-08-22', 24600, '');
t.check('three overlaps are found', fe.pnlOverlappingLabor('2026-08-09', '2026-08-22', '').length === 3);
t.check('the note says how many more there are', /and 2 more/.test(many || ''), many);
t.check('and leads with the exact duplicate rather than whichever came first',
  /Fortnight 16/.test(many || '') && /identical/i.test(many || ''), many);

// ── The amount comparison ────────────────────────────────────────
t.section('what counts as the same run');

const base = { start_date: '2026-08-09', end_date: '2026-08-22', total_amount: 24600 };
t.check('a cent of difference is still the same run',
  fe._isSameLaborRun({ ...base, total_amount: 24600.004 }, '2026-08-09', '2026-08-22', 24600));
t.check('a dollar of difference is not',
  !fe._isSameLaborRun({ ...base, total_amount: 24601 }, '2026-08-09', '2026-08-22', 24600));
t.check('a different end date is not',
  !fe._isSameLaborRun({ ...base, end_date: '2026-08-23' }, '2026-08-09', '2026-08-22', 24600));

t.done();
