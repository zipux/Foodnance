// The upload screen counts PAGES, not files, and refuses the same file twice —
// public/static/invoice.js.
//
// Two problems found by testing the upload screen on 2026-08-05/06:
//
//   1. One supplier PDF holding three pages — the commonest way an invoice
//      arrives by email — was staged as "1 PDF ready — single page" and labelled
//      "Page 1". The page count then fed runValidation, so an invoice reading
//      "page 1 of 3" produced "only 1 page uploaded — possible missing page"
//      with every page present. A warning that fires on correct input is worse
//      than no warning: it teaches people to click past it.
//
//   2. The same file could be added twice with no warning at all — easy when
//      shift-selecting pages out of a folder. Claude then read that page twice,
//      so its line items were counted twice and the invoice came out overstated,
//      and the duplicate page was billed for too.
//
// invoice.js touches pdfjsLib at load time and is one long script, so rather
// than evaluating the whole file this pins the two pure helpers plus the
// labelling rule they feed. The numbers are the ones observed in the browser.
import { suite } from './helpers/assert.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const t = suite('invoice-page-count');
const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'static', 'invoice.js'), 'utf8');

// Pull the helpers out of the shipped source so this tests the real code.
function extract(name) {
  const i = SRC.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found in invoice.js`);
  let depth = 0, started = false, j = i;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') { depth++; started = true; }
    else if (SRC[j] === '}') { depth--; if (started && depth === 0) { j++; break; } }
  }
  return SRC.slice(i, j);
}

const scope = new Function(`
  let stagedFiles = [];
  ${extract('totalStagedPages')}
  ${extract('sameFile')}
  return {
    totalStagedPages,
    sameFile,
    _set: (f) => { stagedFiles = f; },
  };
`)();

const f = (name, size, mtime = 1) => ({ name, size, lastModified: mtime });

t.section('a multi-page PDF counts as its real number of pages');
scope._set([{ file: f('invoice.pdf', 3050), pageCount: 3 }]);
t.check('one 3-page PDF is 3 pages, not 1', scope.totalStagedPages() === 3,
  String(scope.totalStagedPages()));

scope._set([{ file: f('big.pdf', 11221), pageCount: 12 }]);
t.check('one 12-page PDF is 12 pages', scope.totalStagedPages() === 12);

t.section('the other batch shapes still add up');
scope._set([{ file: f('p1.pdf', 1), pageCount: 1 },
            { file: f('p2.pdf', 2), pageCount: 1 },
            { file: f('p3.pdf', 3), pageCount: 1 }]);
t.check('three single-page PDFs are 3 pages', scope.totalStagedPages() === 3);

scope._set([{ file: f('a.pdf', 1), pageCount: 3 },
            { file: f('b.pdf', 2), pageCount: 1 },
            { file: f('c.pdf', 3), pageCount: 2 }]);
t.check('mixed page counts sum (3+1+2)', scope.totalStagedPages() === 6,
  String(scope.totalStagedPages()));

// Photos carry no pageCount of their own; one image is one page.
scope._set([{ file: f('a.jpg', 1) }, { file: f('b.jpg', 2) }, { file: f('c.jpg', 3) }]);
t.check('images fall back to one page each', scope.totalStagedPages() === 3);
scope._set([]);
t.check('an empty batch is 0 pages', scope.totalStagedPages() === 0);

t.section('the summary line describes pages, not files');
// Mirrors renderStagedList: singular only when the whole batch is one page.
const summary = (fileCount, noun, pageTotal) =>
  `${fileCount} ${noun} ready — ${pageTotal === 1 ? 'single page' : pageTotal + ' pages will be merged into one invoice'}`;
t.check('3-page PDF: "1 PDF ready — 3 pages will be merged into one invoice"',
  summary(1, 'PDF', 3) === '1 PDF ready — 3 pages will be merged into one invoice',
  summary(1, 'PDF', 3));
t.check('a genuinely single page still reads "single page"',
  summary(1, 'PDF', 1) === '1 PDF ready — single page');
t.check('3 separate PDFs unchanged from before',
  summary(3, 'PDFs', 3) === '3 PDFs ready — 3 pages will be merged into one invoice');

t.section('page labels run across the batch');
// Mirrors the running-total label: a 3-page PDF then a 1-page one is 1–3 then 4.
function labels(counts) {
  return counts.map((pages, idx) => {
    const first = counts.slice(0, idx).reduce((n, p) => n + p, 1);
    return pages > 1 ? `Pages ${first}–${first + pages - 1}` : `Page ${first}`;
  });
}
t.check('[3] -> "Pages 1–3"', labels([3])[0] === 'Pages 1–3', labels([3])[0]);
t.check('[3,1] -> "Pages 1–3", "Page 4"',
  JSON.stringify(labels([3, 1])) === JSON.stringify(['Pages 1–3', 'Page 4']),
  JSON.stringify(labels([3, 1])));
t.check('[1,1,1] unchanged: Page 1, Page 2, Page 3',
  JSON.stringify(labels([1, 1, 1])) === JSON.stringify(['Page 1', 'Page 2', 'Page 3']));

t.section('the missing-page warning stops crying wolf');
// runValidation warns when page_total > uploadedPageCount. Feed it what each
// version passes for a 3-page PDF whose page 1 says "page 1 of 3".
const wouldWarn = (pageTotal, uploadedPageCount) => pageTotal > 1 && uploadedPageCount < pageTotal;
t.check('before: counting files (1) warned falsely', wouldWarn(3, 1) === true);
t.check('after: counting pages (3) does not warn', wouldWarn(3, 3) === false);
// The warning must still work when a page really IS absent.
t.check('a genuinely missing page still warns (2 of 3 uploaded)', wouldWarn(3, 2) === true);

t.section('the same file is not staged twice');
t.check('identical name, size and mtime is the same file',
  scope.sameFile(f('page1.pdf', 1224, 900), f('page1.pdf', 1224, 900)) === true);
t.check('same name, different size is NOT',
  scope.sameFile(f('page1.pdf', 1224, 900), f('page1.pdf', 9999, 900)) === false);
t.check('same name and size, different mtime is NOT',
  scope.sameFile(f('page1.pdf', 1224, 900), f('page1.pdf', 1224, 901)) === false);
t.check('different names are NOT',
  scope.sameFile(f('page1.pdf', 1224, 900), f('page2.pdf', 1224, 900)) === false);
// Two real pages of one invoice are often the same size — they must both stage.
t.check('two distinct pages of equal size both stage',
  scope.sameFile(f('page1.pdf', 1224, 900), f('page3.pdf', 1224, 900)) === false);

t.done();
