// Food cost calculator (public/static/food-cost-calculator.js) — the arithmetic.
//
// Runs the SHIPPED script, not a copy. The page is a marketing tool whose whole
// value is that the number is right, so the cases below are chosen where a wrong
// answer would look plausible: units that cannot be bridged, half-typed rows,
// decimal commas, trimming yield, and a costing figure that must never quietly
// become $0.
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const { fcCompute, fcConvert, fcParseNumber, fcMoney, fcPct, FC_UNITS } =
  loadBrowserModule(['food-cost-calculator.js'],
    ['fcCompute', 'fcConvert', 'fcParseNumber', 'fcMoney', 'fcPct', 'FC_UNITS']);
const { invUnitInfo } = loadBrowserModule(['utils.js'], ['invUnitInfo']);

const t = suite('food-cost-calculator');
const near = (a, b, e = 1e-9) => typeof a === 'number' && Math.abs(a - b) < e;

// ── The example from the brief ────────────────────────────────────
t.section('The worked example: 10 kg beef $300, 5 kg potatoes $32, 300 g beef + 200 g potatoes');
const example = (extra = {}) => fcCompute({
  purchases: [
    { id: 'b', name: 'Beef', qty: '10', unit: 'kg', paid: '300' },
    { id: 'p', name: 'Potatoes', qty: '5', unit: 'kg', paid: '32' },
  ],
  lines: [
    { purchaseId: 'b', qty: '300', unit: 'g' },
    { purchaseId: 'p', qty: '200', unit: 'g' },
  ],
  ...extra,
});
let r = example();
t.check('beef costs $9.00', near(r.lines[0].cost, 9));
t.check('potatoes cost $1.28', near(r.lines[1].cost, 1.28));
t.check('the dish costs $10.28', near(r.total, 10.28));
t.check('complete, nothing blocked', r.complete && r.blockedCount === 0);
t.check('cost per portion defaults to the whole dish (1 portion)', near(r.costPerPortion, 10.28));
t.check('no price entered: no food cost % (never a made-up number)', r.foodCostPct === null && r.grossProfit === null);

r = example({ price: '34' });
t.check('at $34 the food cost is 30.2%', near(r.foodCostPct, 10.28 / 34 * 100) && fcPct(r.foodCostPct) === '30.2%');
t.check('gross profit is $23.72', near(r.grossProfit, 23.72));
t.check('price for the default 30% target is $34.27', fcMoney(r.targetPrice) === '$34.27');
t.check('a custom target changes the price', near(example({ targetPct: '25' }).targetPrice, 10.28 / 0.25));

r = example({ portions: '4', price: '10' });
t.check('4 portions: $2.57 each', near(r.costPerPortion, 10.28 / 4));
t.check('4 portions, $10 price: 25.7%', fcPct(r.foodCostPct) === '25.7%');

// ── Units ─────────────────────────────────────────────────────────
t.section('Units');
t.check('kg → g', near(fcConvert(1, 'kg', 'g').qty, 1000));
t.check('lb → kg', near(fcConvert(1, 'lb', 'kg').qty, 0.45359237));
t.check('oz (weight) → g', near(fcConvert(1, 'oz', 'g').qty, 28.3495231, 1e-6));
t.check('L → ml', near(fcConvert(1, 'L', 'ml').qty, 1000));
t.check('cup is the 250 ml metric cup', near(fcConvert(1, 'cup', 'ml').qty, 250));
t.check('tbsp is 15 ml, tsp is 5 ml',
  near(fcConvert(1, 'tbsp', 'ml').qty, 15) && near(fcConvert(1, 'tsp', 'ml').qty, 5));
t.check('unit names are case-insensitive', near(fcConvert(2, 'KG', 'G').qty, 2000));
t.check('each → each', near(fcConvert(12, 'each', 'each').qty, 12));
t.check('weight → volume is refused, not guessed', fcConvert(1, 'kg', 'ml').error === 'dimension');
t.check('count → weight is refused', fcConvert(1, 'each', 'g').error === 'dimension');
t.check('an unknown unit is refused', fcConvert(1, 'bushel', 'g').error === 'unknown-unit');
t.check('gallons are deliberately not offered (US and imperial differ by 20%)',
  !FC_UNITS.gal && !FC_UNITS.pt && !FC_UNITS.qt);

// The page must never disagree with the product on a shared unit.
for (const u of ['kg', 'g', 'lb', 'oz', 'l', 'ml', 'fl oz']) {
  const app = invUnitInfo(u), here = FC_UNITS[u];
  t.check(`${u}: same factor and dimension as the app (utils.js)`,
    !!app && !!here && app.dim === here.dim && near(app.factor, here.f, 1e-12));
}

// ── Weight bought, volume used: uncostable, never $0 ──────────────
t.section('Bridging weight and volume');
r = fcCompute({
  purchases: [{ id: 'o', name: 'Olive oil', qty: '2', unit: 'kg', paid: '20' }],
  lines: [{ purchaseId: 'o', qty: '2', unit: 'tbsp' }],
});
t.check('the line is flagged unbridgeable', r.lines[0].status === 'unbridgeable', JSON.stringify(r.lines[0]));
t.check('and explains why', /density/.test(r.lines[0].message));
// Direction matters: the first version named the two sides the wrong way round
// ("bought by volume (kg)"), and only a real browser run caught it.
t.check('the message names what was BOUGHT and what was USED the right way round',
  r.lines[0].message.startsWith('You bought this by weight (kg) but used it by volume.') &&
  /enter the amount in a weight unit\.$/.test(r.lines[0].message), r.lines[0].message);
const rev = fcCompute({
  purchases: [{ id: 'o', name: 'Olive oil', qty: '2', unit: 'L', paid: '20' }],
  lines: [{ purchaseId: 'o', qty: '50', unit: 'g' }],
});
t.check('and the other way: bought by volume, used by weight',
  rev.lines[0].message.startsWith('You bought this by volume (l) but used it by weight.') &&
  /enter the amount in a volume unit\.$/.test(rev.lines[0].message), rev.lines[0].message);
t.check('it contributes nothing to the total, but is not called free', r.total === 0 && r.lines[0].cost === undefined);
t.check('the result is not complete', r.complete === false && r.blockedCount === 1);
t.check('so no cost per portion, no food cost %, no target price',
  r.costPerPortion === null && r.foodCostPct === null && r.targetPrice === null);

// One bad line must not let a partial total pass as the dish cost.
r = fcCompute({
  purchases: [
    { id: 'b', qty: '10', unit: 'kg', paid: '300' },
    { id: 'o', qty: '2', unit: 'kg', paid: '20' },
  ],
  lines: [{ purchaseId: 'b', qty: '300', unit: 'g' }, { purchaseId: 'o', qty: '2', unit: 'tbsp' }],
  price: '34',
});
t.check('good line + bad line: the total so far is shown as partial', near(r.total, 9) && !r.complete);
t.check('but no food cost % is computed over half the ingredients', r.foodCostPct === null);

// ── Trimming / usable yield ───────────────────────────────────────
t.section('Usable yield');
r = fcCompute({
  purchases: [{ id: 'b', qty: '10', unit: 'kg', paid: '300', usable: '85' }],
  lines: [{ purchaseId: 'b', qty: '300', unit: 'g' }],
});
t.check('85% usable: beef is $35.29/kg and 300 g costs $10.59', fcMoney(r.lines[0].cost) === '$10.59', fcMoney(r.lines[0].cost));
t.check('blank usable means 100%', near(fcCompute({
  purchases: [{ id: 'b', qty: '10', unit: 'kg', paid: '300', usable: '' }],
  lines: [{ purchaseId: 'b', qty: '300', unit: 'g' }] }).total, 9));
for (const bad of ['0', '101', '-5', 'abc']) {
  const x = fcCompute({ purchases: [{ id: 'b', qty: '10', unit: 'kg', paid: '300', usable: bad }],
    lines: [{ purchaseId: 'b', qty: '300', unit: 'g' }] });
  t.check(`usable "${bad}" is rejected, not treated as 100`, x.purchases.b.status === 'incomplete' && !x.complete);
}

// ── Incomplete input ──────────────────────────────────────────────
t.section('Half-typed rows');
const incompleteBuy = (patch) => fcCompute({
  purchases: [{ id: 'b', name: 'Beef', qty: '10', unit: 'kg', paid: '300', ...patch }],
  lines: [{ purchaseId: 'b', qty: '300', unit: 'g' }],
});
t.check('no quantity bought → not costed', !incompleteBuy({ qty: '' }).complete && incompleteBuy({ qty: '' }).purchases.b.status === 'incomplete');
t.check('nothing paid → not costed', !incompleteBuy({ paid: '' }).complete);
t.check('$0 paid → not costed (a free ingredient is almost certainly a typo)', !incompleteBuy({ paid: '0' }).complete);
t.check('zero quantity → not costed', !incompleteBuy({ qty: '0' }).complete);
t.check('a use-line with no amount is flagged', (() => {
  const x = fcCompute({ purchases: [{ id: 'b', qty: '10', unit: 'kg', paid: '300' }], lines: [{ purchaseId: 'b', qty: '', unit: 'g' }] });
  return x.lines[0].status === 'incomplete' && !x.complete;
})());
t.check('a use-line with no ingredient is flagged', (() => {
  const x = fcCompute({ purchases: [{ id: 'b', qty: '10', unit: 'kg', paid: '300' }], lines: [{ purchaseId: '', qty: '5', unit: 'g' }] });
  return x.lines[0].status === 'incomplete';
})());
t.check('a fully blank row is ignored, not an error', (() => {
  const x = fcCompute({
    purchases: [{ id: 'b', qty: '10', unit: 'kg', paid: '300' }, { id: 'z', name: '', qty: '', unit: 'kg', paid: '' }],
    lines: [{ purchaseId: 'b', qty: '300', unit: 'g' }, { purchaseId: '', qty: '', unit: 'g' }] });
  return x.complete && near(x.total, 9) && x.blockedCount === 0;
})());
t.check('nothing entered at all: not complete, no numbers', (() => {
  const x = fcCompute({ purchases: [], lines: [] });
  return !x.complete && x.total === 0 && x.costPerPortion === null;
})());
t.check('a use-line pointing at an unfinished product says to fix the product',
  /Finish the product/.test(incompleteBuy({ paid: '' }).lines[0].message));

// ── Portions, price, target ───────────────────────────────────────
t.section('Portions, price and target');
for (const bad of ['0', '-2', 'x']) {
  const x = example({ portions: bad });
  t.check(`portions "${bad}" gives no per-portion figures`, !x.portionsOk && x.costPerPortion === null);
}
t.check('a zero or junk price gives no food cost %', example({ price: '0' }).foodCostPct === null && example({ price: 'abc' }).foodCostPct === null);
for (const bad of ['0', '100', '150', '-1', 'x']) {
  t.check(`target "${bad}" gives no target price`, example({ targetPct: bad }).targetPrice === null);
}
t.check('selling below cost gives a negative gross profit, honestly', near(example({ price: '8' }).grossProfit, 8 - 10.28));

// ── Reading numbers ───────────────────────────────────────────────
t.section('Reading what people type');
const p = fcParseNumber;
t.check('plain', p('300') === 300 && p('0.5') === 0.5 && p('.5') === 0.5 && p('5.') === 5);
t.check('surrounding spaces and a $ sign', p(' $ 32 ') === 32);
t.check('thousands separator', p('1,200') === 1200 && p('12,345.60') === 12345.6);
t.check('decimal comma (French Canadian keyboards)', p('1,5') === 1.5 && p('0,25') === 0.25);
t.check('negative numbers are not accepted', p('-3') === null);
t.check('text is not a number', p('abc') === null && p('1.2.3') === null && p('1e3') === null);
t.check('blank is null, not zero', p('') === null && p('   ') === null && p(null) === null && p(undefined) === null);
t.check('numbers pass through', p(12) === 12);

// ── Display ───────────────────────────────────────────────────────
t.section('Display');
t.check('dollars to the cent', fcMoney(10.28) === '$10.28' && fcMoney(9) === '$9.00');
t.check('thousands grouped', fcMoney(1234.5) === '$1,234.50');
t.check('a pinch of salt is not shown as free', fcMoney(0.004) === '$0.004' && fcMoney(0.004) !== '$0.00');
t.check('zero is $0.00', fcMoney(0) === '$0.00');
t.check('missing values show a dash, never $0.00', fcMoney(null) === '—' && fcMoney(NaN) === '—' && fcPct(null) === '—');
t.check('percentages to one decimal', fcPct(30.2353) === '30.2%' && fcPct(28) === '28.0%');

t.done();
