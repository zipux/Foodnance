// Menu pricing calculator — public marketing tool (menu-pricing-calculator.html).
//
// The food cost calculator answers "what is my food cost?". This one answers the
// question the other way round: "this dish costs me $10.28, what do I charge?".
//
// THE PROMISE THIS FILE KEEPS: nothing typed here is saved or sent anywhere.
// No fetch, no localStorage / sessionStorage / cookies. The page says so in
// plain words, so tests/menu-pricing-calculator.test.mjs fails the build if any
// of those APIs ever appears in this file.
//
// Two halves, like food-cost-calculator.js. The top is pure arithmetic with no
// DOM, so the tests run the SHIPPED code. The bottom wires it to the page.
//
// Same rule as the app's costing: a figure that cannot be worked out is never
// shown as 0. No cost, no target, or a target that leaves no room for a price
// gives "—" and a plain reason, not $0.00.

// ─── Reading what people type ─────────────────────────────────
// Text fields, not type=number, so "1,5" (a decimal comma, common in Quebec)
// and "$1,200.50" are welcome. Same rules as fcParseNumber in
// food-cost-calculator.js (the test compares the two), and it also forgives a
// typed "%" or "x", since this page's fields are a percentage and a markup.
function mpParseNumber(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[\s$€£%×x]/g, '');
  if (s === '') return null;
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ─── The three ways to set a price ────────────────────────────
const MP_METHODS = {
  pct:    { label: 'Target food cost %',   placeholder: '30', start: '30' },
  markup: { label: 'Markup (times cost)',  placeholder: '3',  start: '3' },
  profit: { label: 'Profit per plate ($)', placeholder: '20', start: '20' },
};

// Rounding always goes UP, so the rounded price never falls short of the
// target the owner asked for. Worked in cents: 34.95 is not exact in binary,
// and a price must not jump a whole dollar over a rounding error.
function mpRound(price, rounding) {
  const cents = price * 100;
  if (rounding === 'dollar') return Math.ceil(cents / 100 - 1e-9);
  if (rounding === '95') {
    let c = Math.floor(cents / 100 + 1e-9) * 100 + 95;
    if (c < cents - 1e-6) c += 100;
    return c / 100;
  }
  return Math.round(cents) / 100;   // 'none': to the cent
}

/**
 * @param {{cost:*, method:string, target:*, rounding:string}} input  raw field values
 * @returns {{price:number|null, exact:number|null, foodCostPct:number|null,
 *            profit:number|null, error:string|null}}
 * error: 'no_cost' | 'no_target' | 'pct_too_high' | 'markup_too_low' | null
 */
function mpPrice(input) {
  const none = (error) => ({ price: null, exact: null, foodCostPct: null, profit: null, error });
  const cost = mpParseNumber(input && input.cost);
  if (cost == null || cost <= 0) return none('no_cost');
  const target = mpParseNumber(input.target);
  if (target == null || (input.method !== 'profit' && target <= 0)) return none('no_target');

  let exact;
  if (input.method === 'markup') {
    if (target < 1) return none('markup_too_low');   // below cost
    exact = cost * target;
  } else if (input.method === 'profit') {
    exact = cost + target;
  } else {
    if (target >= 100) return none('pct_too_high');  // the whole price is ingredients
    exact = cost / (target / 100);
  }
  const price = mpRound(exact, input.rounding);
  return { price, exact, foodCostPct: (cost / price) * 100, profit: price - cost, error: null };
}

const MP_ERRORS = {
  no_cost: '',
  no_target: '',
  pct_too_high: 'A food cost of 100% or more leaves nothing for a price. Type a number below 100.',
  markup_too_low: 'A markup below 1 prices the dish under what it costs you. Type 1 or more.',
};

// ─── Formatting ───────────────────────────────────────────────
function mpMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-$' : '$') + s;
}
function mpPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

// ══════════════════════════════════════════════════════════════
// Page wiring. Everything below needs a DOM; the tests do not load it.
// Rows are built with createElement/textContent, because dish names are typed
// by the visitor.
// ══════════════════════════════════════════════════════════════
(function () {
  const EXAMPLE = {
    cost: '10.28',
    dishes: [['Margherita pizza', '4.10'], ['Braised short rib', '10.28'], ['Caesar salad', '3.35']],
  };

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

  function init() {
    const app = document.getElementById('mpApp');
    if (!app) return;
    const $ = (id) => document.getElementById(id);
    const rows = $('mpRows');

    const settings = () => ({ method: $('mpMethod').value, target: $('mpTarget').value, rounding: $('mpRound').value });

    function dishRow(v) {
      v = v || ['', ''];
      const n = rows.children.length + 1;
      const name = el('input', { type: 'text', autocomplete: 'off', placeholder: 'e.g. Caesar salad', 'aria-label': 'Dish ' + n + ' name' });
      const cost = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'e.g. 3.35', 'aria-label': 'Dish ' + n + ' cost', class: 'num' });
      name.value = v[0]; cost.value = v[1];
      const rm = el('button', { type: 'button', class: 'rm', 'aria-label': 'Remove this dish', text: '×' });
      const tr = el('tr', null, [
        el('td', null, [name]),
        el('td', { class: 'num' }, [el('span', { class: 'affix' }, [el('span', { class: 'pre', text: '$', 'aria-hidden': 'true' }), cost])]),
        el('td', { class: 'num price', text: '—' }),
        el('td', { class: 'num', text: '—' }),
        el('td', { class: 'num', text: '—' }),
        el('td', { class: 'num' }, [rm]),
      ]);
      rm.addEventListener('click', () => { tr.remove(); if (!rows.children.length) dishRow(); });
      rows.appendChild(tr);
      return tr;
    }

    function refresh() {
      const s = settings();
      const one = mpPrice({ cost: $('mpCost').value, method: s.method, target: s.target, rounding: s.rounding });
      $('resTotal').textContent = mpMoney(one.price);
      $('resPct').textContent = mpPct(one.foodCostPct);
      $('resProfit').textContent = mpMoney(one.profit);
      const exactNote = $('resExact');
      const rounded = one.price != null && Math.abs(one.price - Math.round(one.exact * 100) / 100) > 0.004;
      exactNote.textContent = rounded ? 'Before rounding: ' + mpMoney(one.exact) : '';

      // A problem with the target applies to every dish, so say it once, up top.
      const targetProblem = mpPrice({ cost: '1', method: s.method, target: s.target, rounding: s.rounding }).error;
      const warn = $('mpWarn');
      warn.textContent = MP_ERRORS[targetProblem] || '';
      warn.hidden = !warn.textContent;

      Array.prototype.forEach.call(rows.children, (tr) => {
        const r = mpPrice({ cost: tr.querySelector('input.num').value, method: s.method, target: s.target, rounding: s.rounding });
        const td = tr.children;
        td[2].textContent = mpMoney(r.price);
        td[3].textContent = mpPct(r.foodCostPct);
        td[4].textContent = mpMoney(r.profit);
      });
    }

    // The example is the worked example printed on the page: 30%, rounded up to .95.
    function fill(example) {
      $('mpMethod').value = 'pct';
      $('mpTargetLabel').textContent = MP_METHODS.pct.label;
      $('mpTarget').placeholder = MP_METHODS.pct.placeholder;
      $('mpTarget').value = MP_METHODS.pct.start;
      $('mpRound').value = example ? '95' : 'none';
      $('mpCost').value = example ? example.cost : '';
      rows.textContent = '';
      (example ? example.dishes : [null, null, null]).forEach(d => dishRow(d));
      refresh();
    }

    $('mpMethod').addEventListener('change', () => {
      const m = MP_METHODS[$('mpMethod').value];
      $('mpTargetLabel').textContent = m.label;
      $('mpTarget').placeholder = m.placeholder;
      $('mpTarget').value = m.start;
    });
    $('mpAddRow').addEventListener('click', () => { dishRow().querySelector('input').focus(); });
    $('loadExample').addEventListener('click', () => fill(EXAMPLE));
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
