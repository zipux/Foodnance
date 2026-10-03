// A product bought by the pack, used by weight — through the weight of one sub-unit.
//
// San Marzano tomatoes: $35.70 a case, 6 cans a case. With "one can = 2.55 kg"
// on the product, a recipe can say 400 g and get a cost (case → can → weight).
// Before this there was no path at all: the weight box was honoured only for
// items bought by the each, so the line was uncostable.
//
// The bridge is deliberately narrow. These tests pin both halves: what it now
// costs, and everything it must leave exactly as it was.
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const { subUnitWeightRate, liveProductLineCost } =
  loadBrowserModule(['utils.js'], ['subUnitWeightRate', 'liveProductLineCost']);

const t = suite('sub-unit-weight');
const near = (label, actual, expected) =>
  t.check(label, actual !== null && Math.abs(actual - expected) < 0.005, `got ${actual}, expected ${expected}`);
const isNull = (label, actual) => t.check(label, actual === null, `got ${actual}`);

const tomato = { cost_per_unit: 35.70, pack_unit: 'case', pack_qty: 1, sub_unit_name: 'can', sub_unit_qty: 6, avg_weight: 2.55 };

t.section('a case-priced product used by weight');
near('1 kg costs $2.33', liveProductLineCost(tomato, 1, 'kg'), 35.70 / 6 / 2.55);
near('400 g costs $0.93', liveProductLineCost(tomato, 400, 'g'), 0.4 * 35.70 / 6 / 2.55);
near('1 lb costs $1.06', liveProductLineCost(tomato, 1, 'lb'), 0.45359237 * 35.70 / 6 / 2.55);
near('one can\'s worth of weight (2.55 kg) costs the same as 1 can', liveProductLineCost(tomato, 2.55, 'kg'), liveProductLineCost(tomato, 1, 'can'));
near('six cans\' worth of weight costs one case', liveProductLineCost(tomato, 6 * 2.55, 'kg'), 35.70);

t.section('what already worked is unchanged');
near('1 can is still $5.95', liveProductLineCost(tomato, 1, 'can'), 5.95);
near('1 case is still $35.70', liveProductLineCost(tomato, 1, 'case'), 35.70);
const fennel = { cost_per_unit: 1.20, pack_unit: 'each', pack_qty: 1, sub_unit_name: '', sub_unit_qty: 0, avg_weight: 0.3 };
near('an each-priced item still uses the box as weight per each', liveProductLineCost(fennel, 1, 'kg'), 1.20 / 0.3);
const fennelWithSub = { ...fennel, sub_unit_name: 'bulb', sub_unit_qty: 4 };
near('…even when it also has a sub-unit', liveProductLineCost(fennelWithSub, 1, 'kg'), 1.20 / 0.3);
const flour = { cost_per_unit: 2, pack_unit: 'kg', pack_qty: 20, sub_unit_name: 'bag', sub_unit_qty: 1, avg_weight: 20 };
near('a weight-priced item still converts by weight alone', liveProductLineCost(flour, 500, 'g'), 1);

t.section('no guessing when a piece is missing');
isNull('no weight entered → still uncostable by weight', liveProductLineCost({ ...tomato, avg_weight: null }, 400, 'g'));
isNull('no sub-unit → still uncostable by weight', liveProductLineCost({ ...tomato, sub_unit_name: '', sub_unit_qty: 0 }, 400, 'g'));
isNull('no units per pack → still uncostable by weight', liveProductLineCost({ ...tomato, sub_unit_qty: 0 }, 400, 'g'));
isNull('volume is not covered (weight only)', liveProductLineCost(tomato, 400, 'ml'));
isNull('"each" is not covered', liveProductLineCost(tomato, 1, 'each'));
isNull('a volume-priced item is not bridged to weight', liveProductLineCost({ ...tomato, pack_unit: 'L' }, 400, 'g'));
isNull('the helper refuses a weight-priced pack unit', subUnitWeightRate({ unitCost: 2, packUnit: 'kg', packQty: 1, subName: 'bag', subQty: 1, avgWeightKg: 20, toUnit: 'g' }));
isNull('the helper refuses an each-priced pack unit', subUnitWeightRate({ unitCost: 2, packUnit: 'each', packQty: 1, subName: 'bulb', subQty: 4, avgWeightKg: 0.3, toUnit: 'g' }));

t.section('the pack quantity is honoured like the sub-unit path');
const twoCasePack = { ...tomato, cost_per_unit: 35.70, pack_qty: 2, sub_unit_qty: 12 };
near('2 cases = 12 cans: same price per kg', liveProductLineCost(twoCasePack, 1, 'kg'), 35.70 / 6 / 2.55);

t.done();
