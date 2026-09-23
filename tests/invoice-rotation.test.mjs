// Static audit: rotating a sideways invoice photo (2026-09-23, migration 0055).
//
// Photos arrive with the page turned sideways (YEN BROS 2815403). The invoice
// screen and the upload page can turn an image page; the turn is remembered on
// invoices.page_rotations. What must hold:
//   · display only — the uploaded file is never re-uploaded or replaced, and
//     Open / Download keep pointing at it;
//   · images only — PDFs use the browser's own viewer;
//   · keyed by FILE, not page number (review and saved mode list pages
//     differently; the file is the same);
//   · a rotation picked on the upload page reaches the saved invoice.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT   = join(dirname(fileURLToPath(import.meta.url)), '..');
const INV    = readFileSync(join(ROOT, 'public', 'static', 'invoices.js'), 'utf8');
const UPL    = readFileSync(join(ROOT, 'public', 'static', 'invoice.js'), 'utf8');
const UPLHTM = readFileSync(join(ROOT, 'public', 'upload-invoice.html'), 'utf8');
const MIG    = readFileSync(join(ROOT, 'migrations', '0055_invoice_page_rotation.sql'), 'utf8');

const t = suite('invoice-rotation');

function between(src, start, end) {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return src.slice(i, j < 0 ? undefined : j);
}

t.check('0055 adds invoices.page_rotations', /ALTER TABLE invoices ADD COLUMN page_rotations TEXT/.test(MIG));

// ── Invoice screen ───────────────────────────────────────────────
const open = between(INV, 'async function openInvDetail(', '\n}\n');
t.check('rotate buttons exist and are only built for images',
  /const rotateBtns = isImage \?/.test(open) && /invRotate\(-90\)/.test(open) && /invRotate\(90\)/.test(open));
t.check('the saved rotations are read from the invoice', /inv\.page_rotations/.test(open));
t.check('Open and Download still use the original file URL',
  /href="\$\{esc\(fileUrl\)\}" target="_blank"/.test(open) && /href="\$\{esc\(fileUrl\)\}" download=/.test(open));

const show = between(INV, 'function _showInvImagePage()', '\nasync function invRotate');
t.check('the turned page is drawn to a canvas and shown as a new image (zoom code untouched)',
  /canvas\.toBlob/.test(show) && /ctx\.rotate\(/.test(show));
t.check('width and height swap for a quarter turn', /quarter \? h : w/.test(show) && /quarter \? w : h/.test(show));
t.check('a stale render from an earlier click is ignored', /token !== _invRotToken/.test(show));
t.check('the previous rotated copy is released', /URL\.revokeObjectURL/.test(show));
t.check('falls back to the page as uploaded if the turned copy can\'t be made',
  /blob \? URL\.createObjectURL\(blob\) : url/.test(show) && /onerror = \(\) => show\(url\)/.test(show));

const rotate = between(INV, 'async function invRotate(', '\nfunction _initInvImgZoom');
t.check('does nothing for PDFs', /_invPageIsPdf\) return/.test(rotate));
t.check('keyed by the page\'s file, not its page number', /_invRotKey\(url\)/.test(rotate) && !/_invPageIdx\]\s*=/.test(rotate));
t.check('remembered on the invoice through the normal update route',
  /apiPatch\(`tables\/\$\{INV_LIST_TABLE\}\/\$\{invId\}`, \{ page_rotations: value \}\)/.test(rotate));
t.check('never uploads or replaces the file', !/apiUploadFile|api\/upload|file_key/.test(rotate + show));

t.check('changing page re-applies that page\'s rotation',
  /function invGotoPage[\s\S]*?_showInvImagePage\(\)/.test(INV));

// ── Upload page ──────────────────────────────────────────────────
const staged = between(UPL, 'function renderStagedList()', '\nfunction ');
t.check('staged photos get rotate buttons, images only',
  /sf\.type === 'img' \?[\s\S]*?rotate-btn/.test(staged));
t.check('the thumbnail shows the turn', /transform:rotate\(\$\{sf\.rotation\}deg\)/.test(staged));
t.check('upload page styles the buttons', /\.staged-item \.rotate-btn/.test(UPLHTM));
const saveRot = between(UPL, 'function stagedPageRotations()', '\nfunction ');
t.check('the upload page saves the turns keyed by each page\'s uploaded file',
  /currentPageKeys\[i\]/.test(saveRot) && /batchType !== 'img'/.test(saveRot));
t.check('and they are sent with the new invoice', /page_rotations:\s*stagedPageRotations\(\)/.test(UPL));
t.check('the file sent to Claude and stored is not rotated',
  !/rotation/.test(between(UPL, 'async function uploadAllPages(', '\n}\n')));

t.done();
