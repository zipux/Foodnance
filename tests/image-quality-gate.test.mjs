// The image quality check warns; it no longer refuses — public/static/image-preproc.js.
//
// The three thresholds measure the IMAGE (resolution, brightness, sharpness) and
// are only a proxy for what Claude can actually read. Measured on 2026-08-06, an
// A4 page scanned at 100 dpi — a perfectly ordinary scanner default — is refused
// for being 827px on its short side while scoring 41,715 for sharpness against a
// minimum of 80. Perfectly legible, and there was no way past it: the panel's
// only advice was "re-scan at a higher resolution", which does not help when
// that is simply what the scanner does.
//
// Blocking a good scan costs the customer the ability to file the invoice at
// all. Letting a bad one through costs one parse. So the judgement is unchanged
// — same thresholds, same wording — and only the consequence moved: it is
// reported as `qualityIssue` and the caller decides.
//
// Two things this file guards especially:
//   * a flagged image must still be resized/deskewed/compressed. The old code
//     returned before all of that, so "upload anyway" would have sent an
//     oversized original and could then have failed for SIZE instead.
//   * a file the browser cannot decode is still fatal. That is not a threshold
//     judgement — there is nothing to enhance and nothing worth sending.
import { suite } from './helpers/assert.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const t = suite('image-quality-gate');
const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'static', 'image-preproc.js'), 'utf8');

// ── The thresholds must not have drifted ─────────────────────────
t.section('thresholds are unchanged');
const num = (k) => Number((SRC.match(new RegExp(k + '\\s*:\\s*([0-9.]+)')) || [])[1]);
t.check('MIN_SHORT_SIDE_PX still 900',  num('MIN_SHORT_SIDE_PX')  === 900,  String(num('MIN_SHORT_SIDE_PX')));
t.check('MIN_AVG_BRIGHTNESS still 30',  num('MIN_AVG_BRIGHTNESS') === 30,   String(num('MIN_AVG_BRIGHTNESS')));
t.check('MAX_AVG_BRIGHTNESS still 245', num('MAX_AVG_BRIGHTNESS') === 245,  String(num('MAX_AVG_BRIGHTNESS')));
t.check('MIN_BLUR_VARIANCE still 80',   num('MIN_BLUR_VARIANCE')  === 80,   String(num('MIN_BLUR_VARIANCE')));

t.section('the wording customers see is unchanged');
for (const phrase of [
  'Resolution too low',
  'Please re-scan or re-photograph at a higher resolution.',
  'Image is too dark',
  'Please re-photograph with better lighting.',
  'Image is overexposed',
  'Please reduce glare and re-photograph.',
  'Image is too blurry',
  'Hold steady and ensure text is in focus.',
]) {
  t.check(`still says "${phrase.slice(0, 42)}"`, SRC.includes(phrase));
}

// ── The behaviour change itself ──────────────────────────────────
t.section('quality failures no longer return early');
// Each threshold must feed the shared qualityIssue, not its own `return`.
const body = SRC.slice(SRC.indexOf('async function preprocessImage'));
const gate = body.slice(0, body.indexOf('const warnings = []'));
t.check('all four thresholds assign qualityIssue',
  (gate.match(/qualityIssue = `/g) || []).length === 4,
  String((gate.match(/qualityIssue = `/g) || []).length));
t.check('none of them returns rejected directly',
  !/if \(shortSide[\s\S]{0,120}return \{ file, rejected: true/.test(gate));
t.check('there is exactly one guarded refusal, behind enforceQuality',
  /if \(qualityIssue && enforceQuality\) \{\s*return \{ file, rejected: true/.test(gate));

t.section('enforceQuality defaults to refusing');
// Any caller that does not opt in keeps the old behaviour — nothing else in the
// codebase silently loosens.
t.check('signature defaults enforceQuality to true',
  /preprocessImage\(file, \{ enforceQuality = true \} = \{\}\)/.test(SRC));

t.section('an allowed-through image is still enhanced');
// The resize/deskew/compress block must sit AFTER the guarded refusal, so a
// flagged image reaches it. If it ever moves above, "upload anyway" starts
// sending oversized originals.
const guardAt   = SRC.indexOf('if (qualityIssue && enforceQuality)');
const resizeAt  = SRC.indexOf('MAX_LONG_SIDE_PX / longSide');
// The CALL site, not the function definition further up the file.
const deskewAt  = SRC.indexOf('detectSkewAngle(resizedGray');
const compressAt = SRC.indexOf('canvasToFile(canvas, file.name, quality)');
t.check('resize happens after the guard',   guardAt > 0 && resizeAt   > guardAt);
t.check('deskew happens after the guard',   guardAt > 0 && deskewAt   > guardAt);
t.check('compress happens after the guard', guardAt > 0 && compressAt > guardAt);
t.check('the success return carries qualityIssue back to the caller',
  /return \{ file: outFile, rejected: false, reason: '', qualityIssue, warnings, metrics \}/.test(SRC));

t.section('an undecodable file is still fatal, whatever the option says');
// This one is not a threshold — there is no image to enhance or send.
const decodeBlock = SRC.slice(SRC.indexOf('async function preprocessImage'),
                              SRC.indexOf('const origW'));
t.check('decode failure returns rejected',
  /Cannot decode image[\s\S]{0,80}/.test(decodeBlock) &&
  /rejected: true, reason: 'Cannot decode image/.test(decodeBlock));
t.check('and it is not behind enforceQuality',
  decodeBlock.indexOf('Cannot decode') < SRC.indexOf('if (qualityIssue && enforceQuality)'));

// ── The upload screen's side of it ───────────────────────────────
const INV = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'static', 'invoice.js'), 'utf8');

t.section('the upload screen checks on staging, not on submit');
t.check('staging runs the check with enforceQuality false',
  /preprocessImage\(entry\.file, \{ enforceQuality: false \}\)/.test(INV));
t.check('submit-time pipeline also stopped enforcing',
  /preprocessImage\(sf\.file, \{ enforceQuality: false \}\)/.test(INV));
t.check('submit skips files already processed at staging',
  /sf\.type === 'img' && !sf\.processed/.test(INV));

t.section('the row shows the objection, and says it can still be uploaded');
t.check('the row renders qualityIssue', /sf\.qualityIssue \? `/.test(INV));
t.check('and offers to proceed', /You can still upload it/.test(INV));

t.section('the summary bar stops saying "ready" over a flagged page');
// The green "N images ready" tick over a photo about to be refused is what made
// the old flow feel like a trap.
t.check('it counts flagged pages', /const flagged = stagedFiles\.filter\(sf => sf\.qualityIssue\)\.length/.test(INV));
t.check('and says so instead of "ready"', /may be too low quality to read/.test(INV));
t.check('offering both ways out', /remove .*, or upload anyway/i.test(INV));

t.section('the hard blocker now only fires for undecodable files');
t.check('it is fed the undecodable list', /showQualityBlocker\(undecodable\)/.test(INV));
t.check('and its wording changed to match', /could not be opened/.test(INV));
t.check('the old blanket "too low quality" stop is gone',
  !/This image is too low quality\. Please re-scan or re-photograph the invoice\./.test(INV));

t.done();
