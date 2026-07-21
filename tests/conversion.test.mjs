// Unit conversion — public/static/utils.js
//
// Why this matters: suppliers invoice the same product in different units (one
// bills potatoes in kg, another in lb). Everything that adds stock or compares
// prices converts through here first. A silent wrong answer corrupts stock
// levels and costs in a way that's very hard to spot after the fact, so the
// "must refuse" cases below are as important as the arithmetic.
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const { invConvertQty, invConvertUnitCost } =
  loadBrowserModule(['utils.js'], ['invConvertQty', 'invConvertUnitCost']);

const t = suite('conversion');
const qty  = (...a) => invConvertQty(...a);
const cost = (...a) => invConvertUnitCost(...a);

const okQty  = (label, got, want) => t.check(label, !got.error && t.near(got.qty,  want), JSON.stringify(got));
const okCost = (label, got, want) => t.check(label, !got.error && t.near(got.cost, want), JSON.stringify(got));
const refuses = (label, got)      => t.check(label, !!got.error, `expected an error, got ${JSON.stringify(got)}`);

t.section('Quantity: the potato case (Neptune bills lb, bin is kg)');
okQty('2 sacks x 50 lb = 100 lb -> kg', qty(100, 'lb', 'kg', null), 45.359237);
okQty('45.359237 kg -> lb',             qty(45.359237, 'kg', 'lb', null), 100);
okQty('round trip 37.5 lb keeps value', qty(qty(37.5, 'lb', 'kg', null).qty, 'kg', 'lb', null), 37.5);

t.section('Quantity: same unit is a no-op (callers that already converted)');
okQty('12 kg -> kg',        qty(12, 'kg', 'kg', null), 12);
okQty('case-insensitive',   qty(5, 'LB', 'lb', null), 5);
okQty('lbs alias -> kg',    qty(10, 'lbs', 'kg', null), 4.5359237);

t.section('Quantity: other dimensions');
okQty('2 L -> ml',   qty(2, 'l', 'ml', null), 2000);
okQty('500 g -> kg', qty(500, 'g', 'kg', null), 0.5);

t.section('Quantity: each <-> weight needs an average weight');
okQty('6 each -> kg at 0.3kg each',  qty(6, 'each', 'kg', 0.3), 1.8);
okQty('1.8 kg -> each at 0.3kg each', qty(1.8, 'kg', 'each', 0.3), 6);
refuses('6 each -> kg with no average weight', qty(6, 'each', 'kg', null));

t.section('Quantity: must refuse rather than assume a factor of 1');
refuses('kg -> L (incompatible dimensions)', qty(5, 'kg', 'l', null));
refuses('L -> each without average weight',  qty(5, 'l', 'each', null));
refuses('unknown unit',                      qty(5, 'flumps', 'kg', null));

t.section('Cost: $/lb and $/kg are the same price, not a 120% move');
okCost('$1.4968548/lb -> $3.30/kg', cost(1.4968548, 'lb', 'kg', null), 3.3);
okCost('$3.30/kg -> $1.4968548/lb', cost(3.3, 'kg', 'lb', null), 1.4968548);
okCost('same unit unchanged',       cost(2.5, 'kg', 'kg', null), 2.5);

t.section('Cost: each <-> weight, and refusals');
okCost('$2/each -> $/kg at 0.5kg each', cost(2, 'each', 'kg', 0.5), 4);
okCost('$4/kg -> $/each at 0.5kg each', cost(4, 'kg', 'each', 0.5), 2);
refuses('$/each -> $/kg with no average weight', cost(2, 'each', 'kg', null));
refuses('$/kg -> $/L',                            cost(2, 'kg', 'l', null));

t.done();
