// Page-count warnings on the upload screen — runValidation() in
// public/static/invoice.js.
//
// Everything in one upload batch is merged into ONE invoice. Two warnings guard
// that, in opposite directions:
//
//   missing_pages  invoice says more pages than you uploaded — one may be lost
//   extra_pages    you uploaded more pages than the invoice claims to have —
//                  they may be two different invoices merged by accident
//
// extra_pages is new (2026-08-06). The dedicated cross-invoice check only ever
// worked for PDFs: it reads an invoice number out of each file locally, whereas
// photos go to Claude in a single call and come back with one number, leaving
// nothing to compare. Photos are also where a mix-up is hardest to spot by eye —
// IMG_4471.jpg tells you nothing — so the gap sat exactly where it hurt.
//
// This file leans hard on the SILENT cases. A page-count warning that fires on
// correct input is how the previous bug in this area did its damage: people
// learn to click past warnings, and then the real one does not work either. Both
// directions are therefore pinned on every combination, not just the failing one.
import { suite } from './helpers/assert.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const t = suite('invoice-page-warnings');
const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'static', 'invoice.js'), 'utf8');

function extract(name) {
  const i = SRC.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found`);
  let depth = 0, started = false, j = i;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') { depth++; started = true; }
    else if (SRC[j] === '}') { depth--; if (started && depth === 0) { j++; break; } }
  }
  return SRC.slice(i, j);
}

const { runValidation, warnings } = new Function(`
  let invoiceWarnings = [];
  ${extract('runValidation')}
  return { runValidation, warnings: () => invoiceWarnings };
`)();

// A parse result whose money side is internally consistent, so the totals check
// stays quiet and only page warnings show up.
function parse(pageTotal, pageCurrent = 1) {
  const r = { items: [{ description: 'Flour', cost: 100 }], total: 100 };
  if (pageTotal !== undefined) r.page_total = pageTotal;
  if (pageCurrent !== undefined) r.page_current = pageCurrent;
  return r;
}

function ids(gpt, uploaded, ocr = '') {
  runValidation(gpt, ocr, uploaded);
  const out = warnings().map(w => w.id);
  warnings().length = 0;
  return out;
}
const has = (gpt, uploaded, id, ocr = '') => ids(gpt, uploaded, ocr).includes(id);
const quiet = (gpt, uploaded, ocr = '') => {
  const w = ids(gpt, uploaded, ocr).filter(i => i === 'missing_pages' || i === 'extra_pages');
  return w.length === 0;
};

// ── The case this was built for ──────────────────────────────────
t.section('two single-page invoices photographed together');
t.check('invoice says 1 page, 2 uploaded -> warns',
  has(parse(1), 2, 'extra_pages'));
t.check('...and it is the extra_pages warning, not missing_pages',
  !has(parse(1), 2, 'missing_pages'));
t.check('three separate one-page dockets -> warns',
  has(parse(1), 3, 'extra_pages'));

t.section('the wording tells you what actually happened');
runValidation(parse(1), '', 2);
// Default to '' rather than reading .message off undefined: with the check
// removed this section should FAIL and say so, not crash the whole file and
// hide the ninety assertions after it.
const extra = warnings().find(w => w.id === 'extra_pages');
const msg = extra ? extra.message : '(no extra_pages warning was raised)';
warnings().length = 0;
t.check('says how many pages were uploaded', /2 pages were uploaded/.test(msg), msg);
t.check('says what the invoice claims',      /page 1 of 1/i.test(msg), msg);
t.check('warns that they MERGE into one invoice', /merged into ONE invoice/i.test(msg), msg);
t.check('names the likely cause',            /two different ones/i.test(msg), msg);
t.check('is a warning, not a hard error',
  (() => { runValidation(parse(1), '', 2);
           const w = warnings().find(x => x.id === 'extra_pages');
           warnings().length = 0; return !!w && w.severity === 'warning'; })());

// ── The silent cases: where crying wolf would do the damage ──────
t.section('correct uploads stay silent');
t.check('1-page invoice, 1 page uploaded',      quiet(parse(1), 1));
t.check('2-page invoice, 2 pages uploaded',     quiet(parse(2), 2));
t.check('3-page invoice, 3 pages uploaded',     quiet(parse(3), 3));
t.check('12-page invoice, 12 pages uploaded',   quiet(parse(12), 12));
t.check('a 3-page PDF in ONE file, now counted as 3', quiet(parse(3), 3));

t.section('no page count printed on the invoice -> say nothing');
for (const [label, val] of [['absent', undefined], ['zero', 0], ['null', null],
                            ['empty string', ''], ['not a number', 'two'],
                            ['negative', -1]]) {
  t.check(`page_total ${label}: silent at 1 page`,  quiet(parse(val), 1));
  t.check(`page_total ${label}: silent at 2 pages`, quiet(parse(val), 2));
  t.check(`page_total ${label}: silent at 5 pages`, quiet(parse(val), 5));
}

// ── The old direction must still work ────────────────────────────
t.section('a genuinely missing page still warns');
t.check('says 3, uploaded 2', has(parse(3), 2, 'missing_pages'));
t.check('says 3, uploaded 1', has(parse(3), 1, 'missing_pages'));
t.check('says 2, uploaded 1', has(parse(2), 1, 'missing_pages'));
t.check('...and does not also claim extra pages', !has(parse(3), 2, 'extra_pages'));

t.section('the two warnings are mutually exclusive');
for (let total = 1; total <= 5; total++) {
  for (let up = 1; up <= 6; up++) {
    const w = ids(parse(total), up).filter(i => i === 'missing_pages' || i === 'extra_pages');
    t.check(`says ${total}, uploaded ${up}: at most one page warning`, w.length <= 1, w.join('+'));
  }
}

t.section('the full matrix says exactly what it should');
const EXPECT = {
  // 'pageTotal,uploaded': expected warning ('' = silent)
  '1,1': '',              '1,2': 'extra_pages',   '1,4': 'extra_pages',
  '2,1': 'missing_pages', '2,2': '',              '2,3': 'extra_pages',
  '3,1': 'missing_pages', '3,2': 'missing_pages', '3,3': '', '3,4': 'extra_pages',
  '5,4': 'missing_pages', '5,5': '',              '5,6': 'extra_pages',
};
for (const [key, want] of Object.entries(EXPECT)) {
  const [total, up] = key.split(',').map(Number);
  const got = ids(parse(total), up).filter(i => i === 'missing_pages' || i === 'extra_pages');
  t.check(`says ${total}, uploaded ${up} -> ${want || 'silent'}`,
    (want === '' ? got.length === 0 : got.length === 1 && got[0] === want),
    got.join('+') || 'silent');
}

// ── Where the page count comes from ──────────────────────────────
t.section('page_total arriving as a string still counts');
// JSON from the model may quote numbers; parseInt handles it, so pin it.
t.check('"2" with 3 uploaded -> extra_pages', has(parse('2'), 3, 'extra_pages'));
t.check('"3" with 2 uploaded -> missing_pages', has(parse('3'), 2, 'missing_pages'));
t.check('"2" with 2 uploaded -> silent', quiet(parse('2'), 2));

t.section('falling back to "page 1 of N" in the text');
// No structured count, but the PDF text layer has it. Both directions must use it.
const noCount = parse(undefined, undefined);
t.check('text says 2, uploaded 3 -> extra_pages',
  has(noCount, 3, 'extra_pages', 'INVOICE page 1 of 2 thank you'));
t.check('text says 3, uploaded 2 -> missing_pages',
  has(noCount, 2, 'missing_pages', 'INVOICE page 1 of 3 thank you'));
t.check('text says 2, uploaded 2 -> silent',
  quiet(noCount, 2, 'INVOICE page 1 of 2 thank you'));
t.check('unrelated text does not invent a count',
  quiet(noCount, 3, 'Delivered to page street, 2 crates'));

t.section('a structured count beats the text');
// page_total is the reliable signal for photos; text is only the fallback.
t.check('page_total 3 wins over "page 1 of 1" in the text',
  quiet(parse(3), 3, 'page 1 of 1'));

// ── Odd inputs must not throw ────────────────────────────────────
t.section('nothing here can crash the upload');
t.check('no parse result at all', (() => { runValidation(null, '', 2);
  const n = warnings().length; warnings().length = 0; return n === 0; })());
t.check('zero pages uploaded', (() => { try { ids(parse(2), 0); return true; }
  catch (_) { return false; } })());
t.check('a huge batch', has(parse(1), 250, 'extra_pages'));
t.check('page_total present but page_current missing',
  has({ items: [{ cost: 100 }], total: 100, page_total: 1 }, 2, 'extra_pages'));

t.section('the money checks are untouched');
t.check('a mismatched total still warns',
  ids({ items: [{ cost: 10 }], total: 999, page_total: 1 }, 1).includes('totals_match'));
t.check('a consistent total does not', !ids(parse(1), 1).includes('totals_match'));

t.done();
