// Pack-size parsing — a PHOTOGRAPH of current behaviour, not a wish list.
//
// This file is deliberately different from pack-size.test.mjs next door. That
// one asserts what the parser SHOULD do. This one records what it DOES do
// today, 2026-08-07, wrong answers included and labelled as such.
//
// Why bother recording wrong answers: the unit alternation and the multiplier
// pattern are shared by two parsers (see the sync audit at the bottom) and are
// read by ten files. Editing them has historically been frightening because
// nothing showed you the blast radius — you changed a regex and hoped. With
// these pins, any edit either leaves every line below alone or it doesn't, and
// the diff tells you exactly which inputs moved. That is the whole point:
// pinning a bug is not endorsing it, it is making the fix legible.
//
// So: a line marked BUG is a known-wrong answer we are holding still on
// purpose. When it gets fixed, the pin SHOULD go red — update it then, and the
// red line is your proof that you changed what you meant to change and nothing
// else. A line with no marker is behaviour to preserve.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePackaging } = loadBrowserModule(['invoices.js'], ['parsePackaging']);

const t = suite('pack-size-pins');

// pin(input, qty, unit, note) — note is free text; prefix 'BUG:' for a
// known-wrong answer that we are recording rather than endorsing.
const pin = (input, qty, unit, note = '') => {
  const got = t_parse(input);
  const label = `${JSON.stringify(input)} -> ${JSON.stringify(qty)} ${JSON.stringify(unit)}${note ? '   ' + note : ''}`;
  t.check(label, got.pack_qty === qty && got.pack_unit === unit, `got ${JSON.stringify(got)}`);
};
function t_parse(s) { return parsePackaging(s); }

t.section('Real lines from the two invoices in Demo Essential (2026-08-07)');
pin('1 kg',   '1',   'kg');                                  // Cioffi catchweight — qty column carries the kilos
pin('2 lb',   '2',   'lb');                                  // Yen Bros
pin('3 KG',   '3',   'KG');                                  // Yen Bros — casing is preserved, not normalised here
pin('2.5KG',  '2.5', 'KG',    'BUG (still open): invoice said 6X2.5KG, the AI dropped the 6 before the app saw it');
pin('4x3 lt', '12',  'L',     'FIXED 2026-08-07: was 4 / "x3 lt"');
pin('BUNCH',  '',    'BUNCH');                               // no leading number -> whole string is the unit

t.section('The multiplier pattern works — when the unit is one it recognises');
pin('6 x 2.5 kg', '15',   'kg');
pin('6X2.5KG',    '15',   'KG',  'note: the RAW invoice text parses correctly. Only the cleaned "2.5KG" is wrong.');
pin('6x2.5KG',    '15',   'KG');
pin('2 x 2 kg',   '4',    'kg');
pin('2 × 2 kg',   '4',    'kg');  // unicode multiplication sign
pin('1 × 1.89L',  '1.89', 'L');
pin('6 x 100OZ',  '600',  'OZ');
pin('6x100 OZ',   '600',  'OZ');
pin('4x3 l',      '12',   'l',   'the SAME pack in a recognised spelling of litre — proves the gap is the word, not the shape');
pin('4x3 L',      '12',   'L');

t.section('Spellings of litre — "lt" now understood, "ltr"/"litre" deliberately not');
// 'lt' was added to the alternation on 2026-08-07. These five lines are the
// ENTIRE behavioural change: a full 18,510-case sweep of the parser before and
// after found 1,914 rows moved and every single one contained 'lt'. Nothing
// without 'lt' moved, and no changed row kept an 'lt' unit — they all became L.
pin('4 x 3 lt',   '12',   'L',        'FIXED 2026-08-07: was 4 / "x 3 lt"');
pin('3 lt',       '3',    'L',        'FIXED 2026-08-07: was 3 / "lt"');
pin('12 lt',      '12',   'L',        'FIXED 2026-08-07: was 12 / "lt"');
pin('1.89 lt',    '1.89', 'L',        'FIXED 2026-08-07: was 1.89 / "lt"');

// 'ltr' and 'litre' were left alone on purpose (Simone's call, 2026-08-07): no
// supplier has ever been seen writing them, and an unused rule is a rule nobody
// checks. Pinned as still-broken so that IF someone adds them later it shows up
// here as a deliberate change rather than a silent one.
pin('4x3 ltr',    '4',    'x3 ltr',   'BUG: left unfixed on purpose');
pin('4x3 litre',  '4',    'x3 litre', 'BUG: left unfixed on purpose');

t.section('Case-count wording is NOT multiplied out (this is correct)');
// The app's AI prompt asks for '50KG' here, because the invoice qty column
// already carries the 20. If the raw wording ever arrives instead, the unit
// comes back unusable and the line is blocked rather than silently multiplied
// to 1000 kg. That refusal is the safe outcome — leave it alone.
pin('50 KG',           '50', 'KG');
pin('20CS of 50KG',    '20', 'CS of 50KG');
pin('20 CS of 50 KG',  '20', 'CS of 50 KG');

t.section('Fraction notation takes the pack size, not the count');
pin('1/5 kg',    '5', 'kg');
pin('1/5 KG CS', '5', 'KG');
pin('1/5 KG',    '5', 'KG');

t.section('Simple "N unit" packs');
pin('18 kg',   '18',   'kg');
pin('1.1 kg',  '1.1',  'kg');
pin('500g',    '500',  'g');
pin('12 LB',   '12',   'LB');
pin('1.89 L',  '1.89', 'L');
pin('5L',      '5',    'L');
pin('35 LB',   '35',   'LB');
pin('12 ct',   '12',   'ct');     // custom unit passes through; blocked later unless the org defined it
pin('12 Each', '12',   'Each');

t.section('Degenerate input leaves the unit blank, so the confirm guard blocks');
// This is the invariant the gallon bug ended on: when it cannot be worked out,
// come back with nothing — never a number, never a zero.
pin('2',       '2',   '');
pin('2.5',     '2.5', '');
pin('',        '',    '');
pin('   ',     '',    '');
pin('case',    '',    'case');
pin('each',    '',    'each');
pin('abc',     '',    'abc');
pin('4x3',     '4',   'x3',    'BUG-ish: no unit at all, so the multiplier cannot apply');
pin('6 x 2.5', '6',   'x 2.5', 'BUG-ish: same');

t.section('What actually reaches costing (pack_qty x order qty)');
// The number that matters is not pack_qty alone, it is pack_qty x the order
// quantity — that is what cost_per_unit divides the line total by. These two
// pin the real money consequence of the two BUGs above.
const totalUnits = (packStr, orderQty) =>
  (parseFloat(parsePackaging(packStr).pack_qty) || 1) * orderQty;

t.check('artichoke "2.5KG" x 1 -> 2.5 units, so $258.89 STILL reads as $103.56/kg (true: 15 units, $17.26/kg)',
  totalUnits('2.5KG', 1) === 2.5, `got ${totalUnits('2.5KG', 1)}`);
t.check('olive oil "4x3 lt" x 1 -> 12 units, so $123.26 now reads as $10.27/L (was $30.82/L)',
  totalUnits('4x3 lt', 1) === 12, `got ${totalUnits('4x3 lt', 1)}`);
t.check('a correctly-read catchweight line is unaffected: "1 kg" x 4.95 -> 4.95 units',
  Math.abs(totalUnits('1 kg', 4.95) - 4.95) < 1e-9, `got ${totalUnits('1 kg', 4.95)}`);

t.section('The two parsers must keep the SAME unit alternation');
// public/static/invoices.js (review screen) and src/index.ts (the write path)
// each carry their own copy of this pattern. They have always been identical.
// If someone teaches one of them a new unit and forgets the other, the review
// screen and the API disagree about what a pack size means — which is the
// mixed-unit class of bug this repo has been bitten by before. Compare the
// source text so the check cannot be fooled by regex-object formatting.
const unitPatOf = (relPath) => {
  const src = readFileSync(join(ROOT, relPath), 'utf8');
  const m = src.match(/const unitPat\s*=\s*'([^']*)'/);
  return m ? m[1] : null;
};
const patFront = unitPatOf('public/static/invoices.js');
const patBack  = unitPatOf('src/index.ts');

t.check('invoices.js declares a unit alternation', patFront !== null, 'pattern not found — did the declaration move?');
t.check('src/index.ts declares a unit alternation', patBack !== null,  'pattern not found — did the declaration move?');
t.check(`both copies are identical (${patFront})`, patFront !== null && patFront === patBack,
  `frontend ${JSON.stringify(patFront)} vs backend ${JSON.stringify(patBack)}`);

t.done();
