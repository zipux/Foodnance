// Pack-size parsing for the invoice review row — public/static/invoices.js
//
// Why this matters: the review row splits a supplier's pack string into an
// editable qty + unit. A multiplied pack like "2 x 2 kg" (= 4 kg) used to
// collapse to qty "2" with an unrecognized "x 2 kg" unit, which shows blank in
// the dropdown and — if approved — gets silently coerced to "each", corrupting
// cost_per_unit and every downstream cost comparison. These cases lock in the
// smart parse and the "leave it blank rather than guess" behavior that the
// confirm-time guard depends on.
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const { parsePackaging } = loadBrowserModule(['invoices.js'], ['parsePackaging']);

const t = suite('pack-size');
const eq = (label, got, wantQty, wantUnit) =>
  t.check(label, got.pack_qty === wantQty && got.pack_unit === wantUnit,
    `got ${JSON.stringify(got)}`);

t.section('Multiplied packs multiply out to a single qty');
eq('"2 x 2 kg" -> 4 kg',   parsePackaging('2 x 2 kg'), '4', 'kg');
eq('"6 x 100 ml" -> 600',  parsePackaging('6 x 100 ml'), '600', 'ml');
eq('unicode x "2 × 2 kg"', parsePackaging('2 × 2 kg'), '4', 'kg');

t.section('Fraction notation takes the pack size, not the count');
eq('"1/5 kg" -> 5 kg', parsePackaging('1/5 kg'), '5', 'kg');

t.section('Simple "N unit" is unchanged');
eq('"18 kg"',  parsePackaging('18 kg'), '18', 'kg');
eq('"1.1 kg"', parsePackaging('1.1 kg'), '1.1', 'kg');
eq('"12 ct" keeps a custom unit', parsePackaging('12 ct'), '12', 'ct');

t.section('Unit-less packs leave the unit blank (so the confirm guard blocks)');
eq('bare number "2" -> no unit', parsePackaging('2'), '2', '');
eq('empty string -> nothing',    parsePackaging(''), '', '');

t.done();
