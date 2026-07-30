// POS sales CSV parsing — public/static/pos-parse.js
//
// Runs against the shipped source via browser-module, so a rename here fails to
// load rather than quietly testing a stale copy.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const t = suite('pos-parse');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const { parseCsv, detectPosFormat, parsePosCsv, posItemKey, posAnySizeKey,
        posMoney, posNum, posNormDate } = loadBrowserModule(
  ['pos-parse.js'],
  ['parseCsv', 'detectPosFormat', 'parsePosCsv', 'posItemKey', 'posAnySizeKey',
   'posMoney', 'posNum', 'posNormDate'],
  { window: {} },
);

// ── tokenizer ────────────────────────────────────────────────
t.section('parseCsv — the shapes real exports actually contain');

const quoted = parseCsv('a,b,c\n1,"Main St, Unit 4",3');
t.check('quoted field keeps its comma', quoted[1][1] === 'Main St, Unit 4', JSON.stringify(quoted[1]));
t.check('and does not shift the columns', quoted[1][2] === '3', JSON.stringify(quoted[1]));

const dq = parseCsv('a\n"6"" pizza"');
t.check('doubled quote becomes one quote', dq[1][0] === '6" pizza', JSON.stringify(dq[1]));

const nl = parseCsv('a,b\n1,"line one\nline two"');
t.check('newline inside quotes stays in the field', nl[1][1] === 'line one\nline two', JSON.stringify(nl));
t.check('and does not create a third row', nl.length === 2, `rows=${nl.length}`);

const crlf = parseCsv('a,b\r\n1,2\r\n');
t.check('CRLF is normalised', crlf.length === 2 && crlf[1][1] === '2', JSON.stringify(crlf));

const bom = parseCsv('﻿Date,Item\n2026-07-20,Pizza');
t.check('BOM is stripped from the first header cell', bom[0][0] === 'Date', JSON.stringify(bom[0]));

const ragged = parseCsv('a,b,c\n1,2');
t.check('short row is padded to header width', ragged[1].length === 3, `len=${ragged[1].length}`);
t.check('padding is empty string', ragged[1][2] === '', JSON.stringify(ragged[1]));

t.check('empty file yields no rows', parseCsv('').length === 0);
t.check('whitespace-only file yields no rows', parseCsv('  \n\n').length === 0);
t.check('trailing newline adds no blank row', parseCsv('a,b\n1,2\n').length === 2);

// ── money ────────────────────────────────────────────────────
t.section('posMoney — POS exports write money as display strings');

t.check('$12.00',      posMoney('$12.00') === 12);
t.check('$0.00',       posMoney('$0.00') === 0);
t.check('-$2.00',      posMoney('-$2.00') === -2);
t.check('($2.00)',     posMoney('($2.00)') === -2);
t.check('$1,234.56',   t.near(posMoney('$1,234.56'), 1234.56));
t.check('empty is 0',  posMoney('') === 0);
t.check('null is 0',   posMoney(null) === 0);
t.check('bare number', posMoney('12.5') === 12.5);
t.check('posNum on Qty', posNum('2') === 2 && posNum('') === 0);

// ── dates ────────────────────────────────────────────────────
t.section('posNormDate — ISO and US, ambiguity refused');

t.check('ISO passes through',        posNormDate('2026-07-20') === '2026-07-20');
t.check('ISO with time is trimmed',  posNormDate('2026-07-20 18:42:11') === '2026-07-20');
t.check('US M/D/YYYY',               posNormDate('7/20/2026') === '2026-07-20');
t.check('US padded',                 posNormDate('07/04/2026') === '2026-07-04');
t.check('day-first is refused',      posNormDate('13/07/2026') === '', posNormDate('13/07/2026'));
t.check('junk is refused',           posNormDate('last tuesday') === '');
t.check('empty is refused',          posNormDate('') === '');

// ── mapping key ──────────────────────────────────────────────
t.section('posItemKey — stable across casing and punctuation');

const k = posItemKey('Margherita Pizza', 'Regular');
t.check('canonical form', k === 'margherita pizza|regular', k);
t.check('case-insensitive',  posItemKey('MARGHERITA PIZZA', 'REGULAR') === k);
t.check('collapses spacing', posItemKey('Margherita  Pizza', ' Regular ') === k);
t.check('strips punctuation', posItemKey('Margherita-Pizza', 'Regular') === k);
t.check('no price point ends in |', posItemKey('Margherita Pizza', '') === 'margherita pizza|');
t.check('any-size fallback derives from a sized key', posAnySizeKey(k) === 'margherita pizza|');

// ── format detection ─────────────────────────────────────────
t.section('detectPosFormat — says why, not just no');

const squareHeader = ['Date', 'Time', 'Category', 'Item', 'Qty', 'Price Point Name', 'Net Sales'];
t.check('recognises a Square header', detectPosFormat(squareHeader).format?.id === 'square');
t.check('case and spacing tolerant',
  detectPosFormat(['  date ', 'ITEM', 'qty', 'net  sales']).format?.id === 'square');

const junk = detectPosFormat(['Name', 'Address', 'Phone']);
t.check('rejects an unrelated file', junk.format === null);
t.check('names every missing column',
  junk.tried[0].missing.join(',') === 'Date,Item,Qty,Net Sales', JSON.stringify(junk.tried));

const partial = detectPosFormat(['Date', 'Item', 'Qty']);
t.check('names the one missing column',
  partial.format === null && partial.tried[0].missing.join(',') === 'Net Sales',
  JSON.stringify(partial.tried));

// ── refusals ─────────────────────────────────────────────────
t.section('parsePosCsv — refuses rather than importing garbage');

t.check('empty file', parsePosCsv('', 'x.csv').error === 'empty');
t.check('header only', parsePosCsv('Date,Item,Qty,Net Sales', 'x.csv').error === 'empty');

const wrongFile = parsePosCsv('Name,Address\nBob,Main St', 'contacts.csv');
t.check('unknown format is refused', wrongFile.error === 'unknown_format');
t.check('and the message names the columns', /Date/.test(wrongFile.message), wrongFile.message);
t.check('and offers the export path', /Item Sales/.test(wrongFile.help || ''), wrongFile.help);

const allRefunds = parsePosCsv(
  'Date,Item,Qty,Net Sales,Event Type\n2026-07-20,Pizza,1,$10.00,Refund',
  'r.csv');
t.check('a file of nothing but refunds is refused', allRefunds.error === 'no_usable_rows', allRefunds.error);

// ── the real fixture ─────────────────────────────────────────
t.section('parsePosCsv — the Square fixture, end to end');

const fixture = join(ROOT, 'tests', 'fixtures', 'square-item-sales-sample.csv');
if (!existsSync(fixture)) {
  t.check('fixture present at tests/fixtures/square-item-sales-sample.csv', false, 'missing');
} else {
  const r = parsePosCsv(readFileSync(fixture, 'utf8'), 'square-item-sales-sample.csv');

  t.check('parses', r.ok === true, r.message || '');
  t.check('detected as square', r.source === 'square', r.source);
  t.check('7 sale lines', r.lines.length === 7, `lines=${r.lines.length}`);
  t.check('3 distinct items to map', r.items.length === 3, `items=${r.items.length}`);

  const qty = Object.fromEntries(r.items.map(i => [i.pos_item_name, i.qty]));
  t.check('Margherita ×5', qty['Margherita Pizza'] === 5, JSON.stringify(qty));
  t.check('Hawaii ×2',     qty['Hawaii Pizza'] === 2,     JSON.stringify(qty));
  t.check('Prosciutto ×1', qty['Prosciutto Pizza'] === 1, JSON.stringify(qty));

  t.check('period starts 2026-07-20', r.period_start === '2026-07-20', r.period_start);
  t.check('period ends 2026-07-26',   r.period_end === '2026-07-26',   r.period_end);

  t.check('gross $105.00',     t.near(r.totals.gross, 105.00),    `${r.totals.gross}`);
  t.check('discounts $2.00',   t.near(r.totals.discounts, 2.00),  `${r.totals.discounts}`);
  t.check('net $103.00',       t.near(r.totals.net, 103.00),      `${r.totals.net}`);
  t.check('tax $8.75',         t.near(r.totals.tax, 8.75),        `${r.totals.tax}`);
  t.check('8 units sold',      r.totals.qty === 8,                `${r.totals.qty}`);

  t.check('net excludes tax', t.near(r.totals.net, r.totals.gross - r.totals.discounts),
    `${r.totals.net} vs ${r.totals.gross - r.totals.discounts}`);

  t.check('the qty-2 line is one line carrying two units',
    r.lines.filter(l => l.qty === 2).length === 1);
  t.check('the discounted line kept its discount',
    r.lines.filter(l => l.discounts === 2).length === 1);
  t.check('modifiers are captured for later',
    r.lines.some(l => l.modifiers === 'Well Done'),
    JSON.stringify(r.lines.map(l => l.modifiers)));
  t.check('external_ref is populated for idempotency',
    r.lines.every(l => l.external_ref !== ''),
    JSON.stringify(r.lines.map(l => l.external_ref)));
  t.check('external_refs are distinct',
    new Set(r.lines.map(l => l.external_ref)).size === r.lines.length);

  t.check('items are sorted biggest seller first',
    r.items[0].pos_item_name === 'Margherita Pizza', r.items[0].pos_item_name);
  t.check('mapping key includes the price point',
    r.items[0].pos_item_key === 'margherita pizza|regular', r.items[0].pos_item_key);
}

t.done();
