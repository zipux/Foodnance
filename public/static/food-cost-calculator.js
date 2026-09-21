// Food cost calculator — public marketing tool (food-cost-calculator.html).
//
// THE PROMISE THIS FILE KEEPS: nothing typed here is saved or sent anywhere.
// No fetch, no localStorage / sessionStorage / cookies, no file input. The page
// says so in plain words, so tests/food-cost-calculator-page.test.mjs fails the
// build if any of those APIs ever appears in this file.
//
// Two halves. The top is pure arithmetic with no DOM, so tests run the SHIPPED
// code (see tests/food-cost-calculator.test.mjs). The bottom wires it to the page.
//
// The rule inherited from the app's costing (see CLAUDE.md, "Costing is derived"):
// a figure that cannot be worked out is NEVER shown as 0. Weight cannot become
// volume without knowing the density, so an ingredient bought by the kilo and
// used by the cup is reported as "can't be costed" and held out of the totals —
// a silent $0.00 would read as a free ingredient and flatter every margin.

// ─── Units ────────────────────────────────────────────────────
// `f` is the size of one unit in the dimension's base unit (kg, litre, each).
// The shared units MUST equal _INV_UNIT_FACTORS in utils.js — the test pins it —
// so this page can never disagree with the product. tsp / tbsp / cup are the
// metric kitchen measures (5 / 15 / 250 ml), which is what Canadian recipes use;
// gallons and pints are left out on purpose, because the US and imperial ones
// differ by 20% and a silent guess would be worse than no answer.
const FC_UNITS = {
  kg:      { dim: 'weight', f: 1 },
  g:       { dim: 'weight', f: 0.001 },
  lb:      { dim: 'weight', f: 0.45359237 },
  oz:      { dim: 'weight', f: 0.0283495231 },   // weight ounce; fluid ounce is 'fl oz'
  l:       { dim: 'volume', f: 1 },
  ml:      { dim: 'volume', f: 0.001 },
  'fl oz': { dim: 'volume', f: 0.0295735296 },   // US fluid ounce
  tsp:     { dim: 'volume', f: 0.005 },
  tbsp:    { dim: 'volume', f: 0.015 },
  cup:     { dim: 'volume', f: 0.25 },           // metric cup, 250 ml
  each:    { dim: 'count',  f: 1 },
};

function fcUnit(u) {
  return FC_UNITS[String(u || '').trim().toLowerCase()] || null;
}

// Returns { qty } or { error }. Never a silent factor of 1.
function fcConvert(qty, from, to) {
  const a = fcUnit(from), b = fcUnit(to);
  if (!a || !b) return { error: 'unknown-unit' };
  if (a.dim !== b.dim) return { error: 'dimension', from: a.dim, to: b.dim };
  return { qty: qty * a.f / b.f };
}

// ─── Reading what people type ─────────────────────────────────
// Fields are text, not type=number, so "1,5" (a decimal comma, common in
// Quebec) and "$1,200.50" are welcome rather than silently blanked by the
// browser. Returns a non-negative number, or null when it isn't one.
function fcParseNumber(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[\s$€£]/g, '');
  if (s === '') return null;
  // A lone comma followed by one or two digits is a decimal comma: "1,5", "0,25".
  // Anything else with commas is thousands separators: "1,200", "12,345.60".
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const fcBlank = (v) => v == null || String(v).trim() === '';

// ─── The calculation ──────────────────────────────────────────
/**
 * @param {object} input
 *   purchases: [{ id, name, qty, unit, paid, usable }]   what was bought
 *   lines:     [{ purchaseId, qty, unit }]                what goes in ONE batch
 *   portions, price, targetPct                            optional, raw text or numbers
 * @returns per-purchase and per-line results, plus totals. Percentages and
 *   prices are null until every ingredient the user started typing is costable.
 */
function fcCompute(input) {
  const purchases = input.purchases || [];
  const lines = input.lines || [];

  // 1. Price per unit of each product, from what was paid for what was usable.
  const byId = {};
  for (const p of purchases) {
    const empty = fcBlank(p.name) && fcBlank(p.qty) && fcBlank(p.paid) && fcBlank(p.usable);
    if (empty) { byId[p.id] = { status: 'empty' }; continue; }

    const qty = fcParseNumber(p.qty);
    const paid = fcParseNumber(p.paid);
    const usable = fcBlank(p.usable) ? 100 : fcParseNumber(p.usable);
    const unit = fcUnit(p.unit);

    let problem = null;
    if (!unit) problem = 'Choose a unit for what you bought.';
    else if (!qty || qty <= 0) problem = 'Enter how much you bought.';
    else if (!paid || paid <= 0) problem = 'Enter what you paid.';
    else if (!usable || usable <= 0 || usable > 100) problem = 'Usable % must be between 1 and 100.';

    if (problem) { byId[p.id] = { status: 'incomplete', problem }; continue; }
    byId[p.id] = {
      status: 'ok',
      unit: String(p.unit).trim().toLowerCase(),
      // Price per purchase unit of the part you can actually serve.
      unitCost: paid / (qty * usable / 100),
    };
  }

  // 2. Cost of each ingredient line.
  let total = 0, okCount = 0, blockedCount = 0;
  const outLines = lines.map((ln) => {
    if (fcBlank(ln.purchaseId) && fcBlank(ln.qty)) return { status: 'empty' };

    const p = byId[ln.purchaseId];
    const qty = fcParseNumber(ln.qty);
    if (!p || p.status === 'empty') {
      blockedCount++; return { status: 'incomplete', message: 'Choose which product this is.' };
    }
    if (p.status === 'incomplete') {
      blockedCount++; return { status: 'incomplete', message: 'Finish the product above first: ' + p.problem };
    }
    if (!qty || qty <= 0) {
      blockedCount++; return { status: 'incomplete', message: 'Enter how much goes in the dish.' };
    }
    const conv = fcConvert(qty, ln.unit, p.unit);
    if (conv.error === 'dimension') {
      blockedCount++;
      // fcConvert(from = the unit USED, to = the unit BOUGHT): name them the right
      // way round. The first version had them swapped and told a customer who
      // bought beef by the kilo that they had "bought it by volume".
      return {
        status: 'unbridgeable',
        message: 'You bought this by ' + conv.to + ' (' + p.unit + ') but used it by ' + conv.from +
          '. Weight and volume cannot be converted without the ingredient\'s density, so enter the amount in a ' +
          conv.to + ' unit.',
      };
    }
    if (conv.error) {
      blockedCount++; return { status: 'incomplete', message: 'Choose a unit for this ingredient.' };
    }
    const cost = conv.qty * p.unitCost;
    total += cost; okCount++;
    return { status: 'ok', cost, unitCost: p.unitCost, unit: p.unit };
  });

  const complete = okCount > 0 && blockedCount === 0;

  // 3. Per portion, food cost %, price for a target. Held back until complete:
  //    a percentage computed over half the ingredients is a wrong number that
  //    looks right.
  const portions = fcBlank(input.portions) ? 1 : fcParseNumber(input.portions);
  const portionsOk = portions != null && portions > 0;
  const costPerPortion = complete && portionsOk ? total / portions : null;

  const price = fcBlank(input.price) ? null : fcParseNumber(input.price);
  const priceOk = price != null && price > 0;
  const target = fcBlank(input.targetPct) ? 30 : fcParseNumber(input.targetPct);
  const targetOk = target != null && target > 0 && target < 100;

  return {
    purchases: byId,
    lines: outLines,
    total,                       // partial while !complete — label it as such
    okCount, blockedCount, complete,
    portionsOk,
    costPerPortion,
    price: priceOk ? price : null,
    foodCostPct:  costPerPortion != null && priceOk ? costPerPortion / price * 100 : null,
    grossProfit:  costPerPortion != null && priceOk ? price - costPerPortion : null,
    targetPct:    targetOk ? target : null,
    targetPrice:  costPerPortion != null && targetOk ? costPerPortion / (target / 100) : null,
  };
}

// ─── Formatting ───────────────────────────────────────────────
// Amounts under 10¢ get three decimals, because rounding a pinch of salt to
// "$0.00" tells the reader it was free.
function fcMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const d = n !== 0 && Math.abs(n) < 0.1 ? 3 : 2;
  const s = Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d });
  return (n < 0 ? '-$' : '$') + s;
}
function fcPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

// ══════════════════════════════════════════════════════════════
// Page wiring. Everything below needs a DOM; the tests do not load it.
// Rows are built with createElement/textContent — never innerHTML — because
// product names are typed by the visitor.
// ══════════════════════════════════════════════════════════════
(function () {
  const UNIT_GROUPS = [
    ['Weight', [['kg', 'kg'], ['g', 'g'], ['lb', 'lb'], ['oz', 'oz']]],
    ['Volume', [['l', 'L'], ['ml', 'ml'], ['fl oz', 'fl oz (US)'], ['tsp', 'tsp'], ['tbsp', 'tbsp'], ['cup', 'cup (250 ml)']]],
    ['Count',  [['each', 'each']]],
  ];
  // What a recipe most often uses for each kind of purchase.
  const NATURAL_USE_UNIT = { weight: 'g', volume: 'ml', count: 'each' };

  let nextId = 1;

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(c => e.appendChild(c));
    return e;
  }

  function unitSelect(label, value) {
    const sel = el('select', { 'aria-label': label });
    UNIT_GROUPS.forEach(([group, opts]) => {
      const og = el('optgroup', { label: group });
      opts.forEach(([v, text]) => og.appendChild(el('option', { value: v, text })));
      sel.appendChild(og);
    });
    sel.value = value;
    return sel;
  }

  // A labelled field. The label is always in the DOM for screen readers; CSS
  // shows it on the first row and on small screens only.
  function field(cls, labelText, control, prefix) {
    const kids = [el('span', { class: 'lbl', text: labelText })];
    if (prefix) {
      kids.push(el('span', { class: 'affix' }, [el('span', { class: 'pre', text: prefix, 'aria-hidden': 'true' }), control]));
    } else {
      kids.push(control);
    }
    return el('label', { class: 'fld ' + cls }, kids);
  }

  function textInput(label, placeholder, mode) {
    return el('input', { type: 'text', inputmode: mode || 'decimal', autocomplete: 'off', placeholder: placeholder || '', 'aria-label': label });
  }

  function init() {
    const app = document.getElementById('fcApp');
    if (!app) return;
    const $ = (id) => document.getElementById(id);
    const buyRows = $('buyRows'), useRows = $('useRows');

    function buyRow(v) {
      v = v || {};
      const id = 'p' + (nextId++);
      const name = textInput('Product name', 'e.g. Beef', 'text'); name.value = v.name || '';
      const qty = textInput('Quantity bought', 'e.g. 10');        qty.value = v.qty || '';
      const unit = unitSelect('Unit bought in', v.unit || 'kg');
      const paid = textInput('Total paid', 'e.g. 300');           paid.value = v.paid || '';
      const usable = textInput('Usable percent', '100');          usable.value = v.usable || '';
      const rm = el('button', { type: 'button', class: 'rm', 'aria-label': 'Remove this product', text: '×' });
      const msg = el('div', { class: 'msg', 'aria-live': 'polite' });
      const row = el('div', { class: 'row buy', 'data-id': id }, [
        field('f-name', 'Product', name),
        field('f-qty', 'Quantity bought', qty),
        field('f-unit', 'Unit', unit),
        field('f-paid', 'Total paid', paid, '$'),
        field('f-usable', 'Usable %', usable),
        rm, msg,
      ]);
      rm.addEventListener('click', () => { row.remove(); refresh(); });
      buyRows.appendChild(row);
    }

    function useRow(v) {
      v = v || {};
      const sel = el('select', { 'aria-label': 'Ingredient' });
      const qty = textInput('Amount used in the dish', 'e.g. 300'); qty.value = v.qty || '';
      const unit = unitSelect('Unit used in the dish', v.unit || 'g');
      const cost = el('output', { class: 'cost', 'aria-label': 'Cost of this ingredient', text: '—' });
      const rm = el('button', { type: 'button', class: 'rm', 'aria-label': 'Remove this ingredient', text: '×' });
      const msg = el('div', { class: 'msg', 'aria-live': 'polite' });
      const row = el('div', { class: 'row use' }, [
        field('f-ing', 'Ingredient (from what you bought)', sel),
        field('f-qty', 'Amount used', qty),
        field('f-unit', 'Unit', unit),
        el('div', { class: 'fld f-cost' }, [el('span', { class: 'lbl', text: 'Cost' }), cost]),
        rm, msg,
      ]);
      row._want = v.purchaseId || null;
      // Picking an ingredient suggests the unit a recipe would use for it — grams
      // for something bought by the kilo — so the common case never trips the
      // weight-vs-volume message. Only when the current unit is the wrong kind.
      sel.addEventListener('change', () => {
        const p = readBuys().find(b => b.id === sel.value);
        const pu = p && fcUnit(p.unit), cur = fcUnit(unit.value);
        if (pu && cur && pu.dim !== cur.dim) unit.value = NATURAL_USE_UNIT[pu.dim];
      });
      rm.addEventListener('click', () => { row.remove(); refresh(); });
      useRows.appendChild(row);
    }

    const val = (row, sel) => row.querySelector(sel);
    function readBuys() {
      return [...buyRows.querySelectorAll('.row.buy')].map(r => ({
        id: r.getAttribute('data-id'),
        name: val(r, '.f-name input').value, qty: val(r, '.f-qty input').value,
        unit: val(r, '.f-unit select').value, paid: val(r, '.f-paid input').value,
        usable: val(r, '.f-usable input').value,
      }));
    }
    function readUses() {
      return [...useRows.querySelectorAll('.row.use')].map(r => ({
        purchaseId: val(r, '.f-ing select').value,
        qty: val(r, '.f-qty input').value, unit: val(r, '.f-unit select').value,
      }));
    }

    // Keep each ingredient dropdown in step with the products above it, without
    // losing what was already chosen.
    function syncIngredientOptions() {
      const buys = readBuys();
      [...useRows.querySelectorAll('.row.use')].forEach(r => {
        const sel = val(r, '.f-ing select');
        const keep = r._want || sel.value;
        r._want = null;
        sel.textContent = '';
        sel.appendChild(el('option', { value: '', text: 'Choose…' }));
        buys.forEach((b, i) => {
          if (fcBlank(b.name) && fcBlank(b.qty) && fcBlank(b.paid)) return;
          sel.appendChild(el('option', { value: b.id, text: b.name.trim() || ('Product ' + (i + 1)) }));
        });
        sel.value = [...sel.options].some(o => o.value === keep) ? keep : '';
      });
    }

    function refresh() {
      syncIngredientOptions();
      const buys = readBuys(), uses = readUses();
      const r = fcCompute({
        purchases: buys, lines: uses,
        portions: $('portions').value, price: $('price').value, targetPct: $('target').value,
      });

      [...buyRows.querySelectorAll('.row.buy')].forEach((row, i) => {
        const p = r.purchases[buys[i].id];
        val(row, '.msg').textContent = p && p.status === 'incomplete' ? p.problem
          : p && p.status === 'ok' ? fcMoney(p.unitCost) + ' per ' + p.unit + (fcBlank(buys[i].usable) ? '' : ' usable') : '';
        row.classList.toggle('bad', !!(p && p.status === 'incomplete'));
      });
      [...useRows.querySelectorAll('.row.use')].forEach((row, i) => {
        const l = r.lines[i];
        val(row, '.cost').textContent = l.status === 'ok' ? fcMoney(l.cost) : '—';
        val(row, '.msg').textContent = l.message || '';
        row.classList.toggle('bad', l.status === 'incomplete' || l.status === 'unbridgeable');
      });

      const warn = $('resWarn');
      if (r.blockedCount > 0) {
        warn.textContent = r.blockedCount === 1
          ? '1 ingredient could not be costed, so the totals below are not final. Fix it above.'
          : r.blockedCount + ' ingredients could not be costed, so the totals below are not final. Fix them above.';
        warn.hidden = false;
      } else warn.hidden = true;

      const hasAny = r.okCount > 0;
      $('resTotal').textContent = hasAny ? fcMoney(r.total) : '—';
      $('resTotalLbl').textContent = r.blockedCount > 0 ? 'Cost so far (incomplete)' : 'Cost of the dish';
      $('resPortion').textContent = fcMoney(r.costPerPortion);
      $('resPct').textContent = r.foodCostPct != null ? fcPct(r.foodCostPct) : '—';
      $('resProfit').textContent = fcMoney(r.grossProfit);
      $('resTarget').textContent = fcMoney(r.targetPrice);
      $('resTargetLbl').textContent = r.targetPct != null ? 'Price for a ' + r.targetPct + '% food cost' : 'Price for your target';
      $('resPctNote').textContent = !r.complete ? '' : r.price == null ? 'Add a selling price to see this.' : '';
      $('portionsNote').hidden = r.portionsOk;
    }

    // ── Buttons ──
    $('addBuy').addEventListener('click', () => { buyRow(); refresh(); });
    $('addUse').addEventListener('click', () => { useRow(); refresh(); });

    function fill(example) {
      buyRows.textContent = ''; useRows.textContent = '';
      if (!example) { buyRow(); buyRow(); useRow(); useRow(); }
      else {
        // Ids are assigned as rows are made, so remember which one each use-line wants.
        const first = nextId;
        example.buys.forEach(b => buyRow(b));
        example.uses.forEach((u, i) => useRow({ purchaseId: 'p' + (first + u.buy), qty: u.qty, unit: u.unit }));
      }
      $('portions').value = example ? example.portions : '';
      $('price').value = example ? example.price : '';
      $('target').value = '';
      refresh();
    }
    $('loadExample').addEventListener('click', () => fill({
      buys: [{ name: 'Beef', qty: '10', unit: 'kg', paid: '300' }, { name: 'Potatoes', qty: '5', unit: 'kg', paid: '32' }],
      uses: [{ buy: 0, qty: '300', unit: 'g' }, { buy: 1, qty: '200', unit: 'g' }],
      portions: '1', price: '34',
    }));
    $('clearAll').addEventListener('click', () => fill(null));

    // Any typing or choosing recalculates. One delegated listener, so rows
    // added later need no wiring.
    app.addEventListener('input', refresh);
    app.addEventListener('change', refresh);

    fill(null);
  }

  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof document !== 'undefined') {
    init();
  }
})();
