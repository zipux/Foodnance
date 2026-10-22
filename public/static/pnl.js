/* ===== pnl.js — Profit & Loss (Phase 1) ===== */
// Cost side comes from /api/pnl (invoices, by category type). Sales + overheads
// are manual, stored in sales_monthly / operating_expenses via generic CRUD.
//
// The period is an inclusive range of WHOLE months (pnlFrom..pnlTo). Whole
// months because sales and one-off costs are stored per month: a part-month
// figure could only be prorated, which would invent precision. Single-month is
// just the range collapsed (from === to), and only then are the month-scoped
// edits (sales box, add one-off, copy last month) offered.

let pnlFrom       = '';     // 'YYYY-MM' — first month of the period (inclusive)
let pnlTo         = '';     // 'YYYY-MM' — last month of the period (inclusive)
// Cost basis: 'purchases' (what you bought) | 'cogs' (stock-take-adjusted true
// cost of goods sold). Sticky per browser; falls back to purchases when the
// bracketing stock takes for the period don't exist.
let pnlBasis      = (localStorage.getItem('pnlBasis') === 'cogs') ? 'cogs' : 'purchases';
let pnlCosts      = { food_cost: 0, beverage_cost: 0, supplies_cost: 0, invoice_fees: 0,
                      supplies_breakdown: [], food_uncategorized: 0,
                      pending_invoices: { count: 0, amount: 0 } };
let pnlSalesRows  = [];     // sales_monthly rows inside the period
let pnlOverheads  = [];     // operating_expenses rows inside the period (one-offs)
let pnlRecurring  = [];     // recurring_expenses rows (fixed monthly costs — every month)
let pnlSpread     = [];     // spread_expenses rows (a bill split across the months it covers)
let pnlLabor      = [];     // labor_periods rows (staff cost, prorated across the months a pay period covers)
let pnlAllSales   = [];     // all sales_monthly rows (cache)
let pnlAllOh      = [];     // all operating_expenses rows (cache — for copy-last-month)

// ── Month helpers ──────────────────────────────────────────────
const monthStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Shift a 'YYYY-MM' by n months.
function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  return monthStr(new Date(y, m - 1 + n, 1));
}

// Whole months from `from` to `to` inclusive, e.g. ('2026-04','2026-06') →
// ['2026-04','2026-05','2026-06']. 'YYYY-MM' sorts lexicographically.
function monthsInRange(from, to) {
  const out = [];
  for (let m = from; m <= to && out.length < 600; m = addMonths(m, 1)) out.push(m);
  return out;
}

function monthCount(from, to) { return monthsInRange(from, to).length; }

function prevMonthStr(month) { return addMonths(month, -1); }

// "July 2026" / "April – June 2026" / "November 2025 – February 2026"
function periodLabel(from, to) {
  const nice = m => new Date(m + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  if (from === to) return nice(from);
  const shortMon = m => new Date(m + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long' });
  // Same year → don't repeat it: "April – June 2026"
  if (from.slice(0, 4) === to.slice(0, 4)) return `${shortMon(from)} – ${nice(to)}`;
  return `${nice(from)} – ${nice(to)}`;
}

// Preset → whole-month range. "This quarter"/"Year to date" run up to the
// current month (period-to-date), matching the Spending Breakdown's presets.
function pnlPresetRange(preset) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const thisMonth = monthStr(now);
  switch (preset) {
    case 'this-month':   return { from: thisMonth, to: thisMonth };
    case 'last-month':   { const p = addMonths(thisMonth, -1); return { from: p, to: p }; }
    case 'this-quarter': return { from: monthStr(new Date(y, Math.floor(m / 3) * 3, 1)), to: thisMonth };
    case 'ytd':          return { from: `${y}-01`, to: thisMonth };
  }
}

function pnlSetActivePreset(preset) {
  document.querySelectorAll('.pnl-preset-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.preset === preset));
}

// Which preset (if any) the current range corresponds to — so the chip stays lit
// after prev/next or a manual pick that happens to match.
function pnlMatchingPreset() {
  for (const p of ['this-month', 'last-month', 'this-quarter', 'ytd']) {
    const r = pnlPresetRange(p);
    if (r.from === pnlFrom && r.to === pnlTo) return p;
  }
  return null;
}

function pnlSetRange(from, to, { load = true } = {}) {
  pnlFrom = from; pnlTo = to;
  pnlClearDays();                       // a month range leaves the exact-dates view
  document.getElementById('pnlFrom').value = from;
  document.getElementById('pnlTo').value   = to;
  pnlSetActivePreset(pnlMatchingPreset());
  if (load) loadPnl();
}

// Prev/next move by the length of the current period: a single month steps one
// month, a Q2 view steps to Q1.
function shiftPeriod(direction) {
  const span = monthCount(pnlFrom, pnlTo);
  pnlSetRange(addMonths(pnlFrom, direction * span), addMonths(pnlTo, direction * span));
}

function pnlSetBasis(basis) {
  pnlBasis = (basis === 'cogs') ? 'cogs' : 'purchases';
  localStorage.setItem('pnlBasis', pnlBasis);
  render();
}

function pnlApplyCustom() {
  const from = document.getElementById('pnlFrom').value;
  const to   = document.getElementById('pnlTo').value;
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
    showToast('Pick a From and To month.', 'error'); return;
  }
  if (to < from) { showToast('The "To" month is before the "From" month.', 'error'); return; }
  pnlSetRange(from, to);
}

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('pnl-page-marker')) return;

  document.querySelectorAll('.pnl-preset-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const r = pnlPresetRange(btn.dataset.preset);
      pnlSetRange(r.from, r.to);
    }));
  document.getElementById('pnlApply').addEventListener('click', pnlApplyCustom);
  document.getElementById('pnlPrev').addEventListener('click', () => shiftPeriod(-1));
  document.getElementById('pnlNext').addEventListener('click', () => shiftPeriod(1));

  // Spread-cost modal
  document.getElementById('closeSpreadModal').addEventListener('click', () => closeModal('spreadModal'));
  document.getElementById('cancelSpreadModal').addEventListener('click', () => closeModal('spreadModal'));
  document.getElementById('spreadModal').addEventListener('click', e => {
    if (e.target === document.getElementById('spreadModal')) closeModal('spreadModal');
  });
  document.getElementById('saveSpreadBtn').addEventListener('click', pnlSaveSpread);
  ['spreadTotal', 'spreadStart', 'spreadEnd'].forEach(id =>
    document.getElementById(id).addEventListener('input', updateSpreadPreview));

  // Labour (pay period) modal
  document.getElementById('closeLaborModal').addEventListener('click', () => closeModal('laborModal'));
  document.getElementById('cancelLaborModal').addEventListener('click', () => closeModal('laborModal'));
  document.getElementById('laborModal').addEventListener('click', e => {
    if (e.target === document.getElementById('laborModal')) closeModal('laborModal');
  });
  document.getElementById('saveLaborBtn').addEventListener('click', pnlSaveLabor);
  ['laborTotal', 'laborStart', 'laborEnd'].forEach(id =>
    document.getElementById(id).addEventListener('input', updateLaborPreview));

  document.getElementById('pnlDayApply').addEventListener('click', pnlApplyDays);
  document.getElementById('pnlCountPick').addEventListener('change', pnlPickCounts);
  pnlShowDatesBar();
  window.addEventListener('dm:plan-known', pnlShowDatesBar);
  // The tax names follow the business's province, learnt with the plan.
  window.addEventListener('dm:plan-known', () => { if (pnlLoaded) render(); });

  const start = pnlPresetRange('this-month');
  pnlSetRange(start.from, start.to);   // loads
});

// ── Load ───────────────────────────────────────────────────────
let pnlLoaded = false;   // a statement has been drawn, so a repaint is safe
async function loadPnl() {
  const body = document.getElementById('pnlBody');
  body.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:2rem 1rem"><i class="fas fa-spinner fa-spin"></i> Loading…</div>`;
  try {
    const [costs, salesData, ohData, recData, spData, labData] = await Promise.all([
      apiGet(pnlDays ? `pnl?from=${pnlDays.from}&to=${pnlDays.to}` : `pnl?from=${pnlFrom}&to=${pnlTo}`),
      apiGet(`tables/sales_monthly?page=1&limit=500`),
      apiGet(`tables/operating_expenses?page=1&limit=1000`),
      apiGet(`tables/recurring_expenses?page=1&limit=500`),
      apiGet(`tables/spread_expenses?page=1&limit=500`),
      apiGet(`tables/labor_periods?page=1&limit=500`),
    ]);
    const inPeriod = r => r.period >= pnlFrom && r.period <= pnlTo;
    pnlCosts     = costs || pnlCosts;
    pnlAllSales  = salesData.data || [];
    pnlAllOh     = ohData.data || [];
    pnlSalesRows = pnlAllSales.filter(inPeriod).sort((a, b) => a.period < b.period ? -1 : 1);
    pnlOverheads = pnlAllOh.filter(inPeriod)
      .sort((a, b) => (a.period + (a.created_at || '')) < (b.period + (b.created_at || '')) ? -1 : 1);
    pnlRecurring = (recData.data || [])
      .filter(r => r.active == null || Number(r.active) === 1)
      .sort((a, b) => (a.created_at || '') < (b.created_at || '') ? -1 : 1);
    pnlSpread    = (spData.data || [])
      .sort((a, b) => (a.created_at || '') < (b.created_at || '') ? -1 : 1);
    // Oldest pay period first — they read as a sequence, not a pile.
    pnlLabor     = (labData.data || [])
      .sort((a, b) => (a.start_date || '') < (b.start_date || '') ? -1 : 1);
    pnlLoaded = true;
    render();
  } catch (e) {
    body.innerHTML = `<div style="text-align:center;color:#b91c1c;padding:2rem 1rem"><i class="fas fa-exclamation-triangle"></i> Failed to load P&amp;L: ${esc(e.message)}</div>`;
  }
}

// ── Render ─────────────────────────────────────────────────────
// The taxes sentence under the statement, in the province's own words
// (taxNames in utils.js): "GST and refundable deposits are left out; PST is
// counted." in BC, "HST and refundable deposits are left out." in Ontario.
function pnlTaxNote() {
  const t = taxNames();
  return `${t.fed} and refundable deposits are left out${t.prov ? `; ${t.prov} is counted` : ''}.`;
}
// ── Waste, and stock missing with no reason ───────────────────
// Two blocks under the cost lines. They EXPLAIN part of the cost and are never
// added to it: stock that was lost is already inside true COGS, because the
// closing count found less. Each opens to the entries behind its total.
let pnlWasteOpen   = false;
let pnlMissingOpen = false;
function pnlToggleWaste(which) {
  if (which === 'missing') pnlMissingOpen = !pnlMissingOpen; else pnlWasteOpen = !pnlWasteOpen;
  render();
}
const PNL_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function pnlShortDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `${+m[3]} ${PNL_MON[+m[2] - 1]}` : '';
}
function pnlQty(n) {
  return String(Math.round((Number(n) || 0) * 1000) / 1000);
}
// Sub-percent shares matter here (waste is small against sales), so one decimal
// below 10% where the cost lines above round to whole numbers.
function pnlSmallPct(text, n, total) {
  if (text === '—' || !(total > 0)) return text;
  const p = (n / total) * 100;
  return p > 0 && p < 10 ? p.toFixed(1) + '%' : text;
}

function wasteBlocksHtml(w, useCogs, pct, sales) {
  if (!w) return '';
  const missing = w.missing || { total: 0, entries: [] };
  if (!(w.entries || []).length && !(missing.entries || []).length) return '';
  const inside = useCogs ? 'Already inside the food cost above.' : 'It does not change the figures above.';
  const n = (list, word) => `${list.length} ${list.length === 1 ? word : (word === 'entry' ? 'entries' : word + 's')}`;
  let html = '';

  if (w.entries.length) {
    const top = Math.max(...w.by_reason.map(r => r.value), 0.01);
    html += `
    <div class="pnl-waste">
      <div class="pnl-waste-head">
        <div class="t">Waste, stock lost outside a sale</div>
        <div class="pnl-amount">${fmtMoney(w.total)}</div>
        <div class="pnl-pct">${pnlSmallPct(pct(w.total), w.total, sales)}</div>
      </div>
      ${w.by_reason.map(r => `
      <div class="pnl-waste-reason">
        <span>${esc(r.label)}</span>
        <span class="pnl-waste-track"><span style="width:${Math.max(3, Math.round((r.value / top) * 100))}%"></span></span>
        <span class="pnl-waste-num">${fmtMoney(r.value)}</span>
      </div>`).join('')}
      ${pnlWasteOpen ? `
      <div class="pnl-waste-scroll"><table>
        <thead><tr><th>Date</th><th>Item</th><th class="r">Amount</th><th>Reason</th><th class="r">Worth</th></tr></thead>
        <tbody>${w.entries.map(e => `
          <tr><td>${esc(pnlShortDate(e.date))}</td>
              <td>${esc(e.item_name)}${e.note ? `<div class="pnl-sub">${esc(e.note)}</div>` : ''}</td>
              <td class="r pnl-waste-num">${pnlQty(e.qty)} ${esc(e.unit)}</td>
              <td>${esc(e.reason)}</td><td class="r pnl-waste-num">${fmtMoney(e.value)}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
      <div class="pnl-sub">${inside} Shown so you can see where it went.
        <a href="#" onclick="pnlToggleWaste('waste');return false">${pnlWasteOpen ? 'Hide the entries' : `Show the ${n(w.entries, 'entry')}`}</a></div>
    </div>`;
  }

  if (missing.entries.length) {
    html += `
    <div class="pnl-waste pnl-missing">
      <div class="pnl-waste-head">
        <div class="t">Missing at the count, no reason given</div>
        <div class="pnl-amount">${fmtMoney(missing.total)}</div>
        <div class="pnl-pct">${pnlSmallPct(pct(missing.total), missing.total, sales)}</div>
      </div>
      ${pnlMissingOpen ? `
      <div class="pnl-waste-scroll"><table>
        <thead><tr><th>Date</th><th>Item</th><th class="r">Expected</th><th class="r">Counted</th><th class="r">Missing</th><th class="r">Worth</th></tr></thead>
        <tbody>${missing.entries.map(e => `
          <tr><td>${esc(pnlShortDate(e.date))}</td><td>${esc(e.item_name)}</td>
              <td class="r pnl-waste-num">${pnlQty(e.expected_qty)} ${esc(e.unit)}</td>
              <td class="r pnl-waste-num">${pnlQty(e.counted_qty)} ${esc(e.unit)}</td>
              <td class="r pnl-waste-num">${pnlQty(e.qty)} ${esc(e.unit)}</td>
              <td class="r pnl-waste-num">${fmtMoney(e.value)}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
      <div class="pnl-sub">${useCogs ? 'Also inside the food cost above.' : inside} Nobody said why it is gone: it may be waste
        that was not recorded, portions bigger than the recipe says, or a delivery that came short.
        <a href="#" onclick="pnlToggleWaste('missing');return false">${pnlMissingOpen ? 'Hide the items' : `Show the ${n(missing.entries, 'item')}`}</a></div>
    </div>`;
  }
  return html;
}

function fmtMoney(n) {
  const num = parseFloat(n) || 0;
  return (num < 0 ? '-$' : '$') + Math.abs(num).toFixed(2);
}

// The day number and the by-days shares are the shared ones in utils.js (see
// periodProfitSummary there); these names are kept for the rest of this file.
function _dayNum(ymd) { return monthProfitDayNum(ymd); }

// Fair share of a spread cost that falls inside `month` ('YYYY-MM').
// Returns { allocated, overlapDays, totalDays }.
function spreadAllocation(row, month) { return monthProfitAllocation(row, month); }

// A spread cost's share of a whole period = the sum of its monthly shares.
function spreadAllocationRange(row, from, to) {
  return monthProfitAllocationRange(row, monthsInRange(from, to));
}

// Short human range label, e.g. "13 Jun – 18 Sep 2026".
// Is a fixed monthly cost being paid in month `m` ('YYYY-MM')?
//
// Both bounds are inclusive and either may be absent. Absent means "no
// boundary", which is what every row meant before dates existed — so a row
// nobody has dated behaves exactly as it always has. 'YYYY-MM' sorts
// lexicographically, so these are plain string comparisons.
//
// The point of this: rent applied to every month forever, including months
// before the business existed, so an empty January reported a $9,670 loss and
// Year to Date carried thousands against no sales.
function recurringActiveIn(row, m) { return monthProfitFixedDated(row, m); }

// The note beside a fixed cost's month boxes. It deliberately never repeats the
// dates — the two inputs are right there showing them — and says only what the
// boxes cannot: whether this row reached the period on screen, and how much of
// it. `months` is how many months of the current period the row was paid in.
function recurringMonthsNote(row, monthsActive, nMonths, single) {
  const dated = (row.start_period || '').trim() || (row.end_period || '').trim();
  // The row is listed but contributes nothing — without this it looks like the
  // total is wrong, or like the cost was forgotten.
  if (monthsActive === 0) return single ? 'not paid this month' : 'not paid in this period';
  if (!dated)             return 'every month';
  if (!single && monthsActive !== nMonths) return `counted in ${monthsActive} of ${nMonths} months`;
  return '';
}

function spreadRangeLabel(row) {
  const fmtOne = ymd => {
    const [y, m, d] = String(ymd || '').split('-').map(Number);
    if (!y) return '?';
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1];
    return `${d} ${mon} ${y}`;
  };
  return `${fmtOne(row.start_date)} – ${fmtOne(row.end_date)}`;
}

function render() {
  if (pnlDays) return renderDays();
  const months   = monthsInRange(pnlFrom, pnlTo);
  const nMonths  = months.length;
  const single   = pnlFrom === pnlTo;     // month-scoped edits only make sense here
  // The arithmetic lives in utils.js (periodProfitSummary), shared with the
  // Home strip so the two can never disagree. This page only draws it.
  const { imported, salesByMonth, sales, foodBought, bevBought, supplies,
          cogsData, cogsAvail, useCogs, food, beverage, fees,
          pst, ohTotal, fixedAlloc, fixedTotal, fixedPerMonth, fixedAllMonths,
          spreadThisMonth, spreadTotal, missingSales, expenseInv, expenseInvTotal, laborThisPeriod,
          laborTotal, cogsTotal, gross, running, net, prime,
          hasSales } =
    periodProfitSummary(months, {
      costs: pnlCosts, sales_rows: pnlSalesRows, one_offs: pnlOverheads,
      fixed: pnlRecurring, spread: pnlSpread, labor: pnlLabor,
    }, pnlBasis);

  const pct = n => hasSales ? Math.round((n / sales) * 100) + '%' : '—';

  const costRow = (label, sub, amount) => `
    <div class="pnl-row">
      <div><div class="pnl-label">${label}</div>${sub ? `<div class="pnl-sub">${sub}</div>` : ''}</div>
      <div class="pnl-amount">${fmtMoney(amount)}</div>
      <div class="pnl-pct">${amount ? pct(amount) : '—'}</div>
    </div>`;

  const totalRow = (label, amount, tone) => `
    <div class="pnl-total ${tone}">
      <div class="pnl-label">${label}</div>
      <div class="pnl-amount ${amount < 0 ? 'neg' : ''}">${fmtMoney(amount)}</div>
      <div class="pnl-pct">${pct(amount)}</div>
    </div>`;

  const monthShort = m => new Date(m + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

  // Fixed monthly cost rows (recurring — editable, with the months they run).
  // The dates sit on their own line under the row rather than as two more
  // columns: they are usually blank, and crowding them into the money line
  // would make the common case harder to read than the rare one.
  const fixedRowsHtml = fixedAlloc.map(x => {
    const r    = x.row;
    const note = recurringMonthsNote(r, x.months, nMonths, single);
    return `
    <div style="padding-bottom:.35rem">
      <div class="pnl-oh-row">
        <input type="text" value="${esc(r.name || '')}" placeholder="e.g. Rent, Insurance, Licence"
               onchange="pnlUpdateRecurring('${esc(r.id)}','name',this.value)" />
        <input type="number" step="0.01" min="0" value="${r.amount != null ? r.amount : ''}" placeholder="0.00"
               onchange="pnlUpdateRecurring('${esc(r.id)}','amount',this.value)" />
        <button class="pnl-oh-del" title="Remove" onclick="pnlDeleteRecurring('${esc(r.id)}')"><i class="fas fa-times"></i></button>
      </div>
      <div class="pnl-fixed-when">
        <span>Paid from</span>
        <input type="month" value="${esc(r.start_period || '')}" title="First month you paid this. Leave blank for every month."
               onchange="pnlUpdateRecurring('${esc(r.id)}','start_period',this.value)" />
        <span>to</span>
        <input type="month" value="${esc(r.end_period || '')}" title="Last month you paid this. Leave blank if you still pay it."
               onchange="pnlUpdateRecurring('${esc(r.id)}','end_period',this.value)" />
        <span class="pnl-fixed-hint">${esc(note)}</span>
      </div>
    </div>`;
  }).join('');

  // Manual one-off overhead rows (editable). Over a multi-month period each row
  // is tagged with the month it belongs to.
  const ohRowsHtml = pnlOverheads.map(r => `
    <div class="pnl-oh-row">
      <div>
        ${single ? '' : `<div class="pnl-sub" style="margin:0 0 .15rem .1rem">${esc(monthShort(r.period))}</div>`}
        <input type="text" value="${esc(r.name || '')}" placeholder="Expense name"
               onchange="pnlUpdateOverhead('${esc(r.id)}','name',this.value)" />
      </div>
      <input type="number" step="0.01" min="0" value="${r.amount != null ? r.amount : ''}" placeholder="0.00"
             onchange="pnlUpdateOverhead('${esc(r.id)}','amount',this.value)" />
      <button class="pnl-oh-del" title="Remove" onclick="pnlDeleteOverhead('${esc(r.id)}')"><i class="fas fa-times"></i></button>
    </div>`).join('');

  // Spread cost rows for this month (click to edit; fair-share shown)
  const spreadRowsHtml = spreadThisMonth.map(x => {
    const r = x.row;
    return `
      <div class="pnl-row" style="cursor:pointer" onclick="pnlEditSpread('${esc(r.id)}')" title="Edit">
        <div>
          <div class="pnl-label">${esc(r.name || 'Spread cost')}</div>
          <div class="pnl-sub">${fmtMoney(x.allocated)} of ${fmtMoney(r.total_amount)} · ${esc(spreadRangeLabel(r))} · ${x.overlapDays}/${x.totalDays} days</div>
        </div>
        <div class="pnl-amount">${fmtMoney(x.allocated)}</div>
        <button class="pnl-oh-del" title="Remove" onclick="event.stopPropagation();pnlDeleteSpread('${esc(r.id)}')"><i class="fas fa-times"></i></button>
      </div>`;
  }).join('');

  // Pay-period rows (click to edit) — same presentation as a spread cost.
  const laborRowsHtml = laborThisPeriod.map(x => {
    const r = x.row;
    const partial = x.overlapDays < x.totalDays;
    return `
      <div class="pnl-row" style="cursor:pointer" onclick="pnlEditLabor('${esc(r.id)}')" title="Edit">
        <div>
          <div class="pnl-label">${esc(r.name || 'Pay period')}</div>
          <div class="pnl-sub">${esc(spreadRangeLabel(r))}${
            partial ? ` · ${fmtMoney(x.allocated)} of ${fmtMoney(r.total_amount)} · ${x.overlapDays}/${x.totalDays} days` : ''}</div>
        </div>
        <div class="pnl-amount">${fmtMoney(x.allocated)}</div>
        <button class="pnl-oh-del" title="Remove" onclick="event.stopPropagation();pnlDeleteLabor('${esc(r.id)}')"><i class="fas fa-times"></i></button>
      </div>`;
  }).join('');

  // Someone who was already typing payroll into a plain expense line will double
  // count the moment they use this section. Amber once both exist (their profit
  // is wrong right now); grey when only the old row does, where it is a
  // suggestion rather than a fault.
  const WAGEISH = /\b(wage|wages|payroll|salar\w*|labou?r|staff\s*cost)\b/i;
  const wageishRows = [...pnlRecurring, ...pnlOverheads, ...pnlSpread]
    .filter(r => WAGEISH.test(String(r.name || '')));
  const wageishNames = wageishRows.map(r => esc(r.name)).join('</strong>, <strong>');
  const laborDoubleNote = wageishRows.length
    ? (laborTotal > 0
      ? `<div class="pnl-sub" style="color:#b45309;padding:.35rem .25rem">
           <i class="fas fa-triangle-exclamation"></i> You also have
           ${wageishRows.length === 1 ? 'a cost line' : 'cost lines'} called
           <strong>${wageishNames}</strong>. Staff cost is being counted twice —
           remove ${wageishRows.length === 1 ? 'it' : 'them'} from the lists below,
           or delete the pay periods here.
         </div>`
      : `<div class="pnl-sub" style="color:#6b7280;padding:.35rem .25rem">
           <i class="fas fa-circle-info"></i> You track staff cost as
           <strong>${wageishNames}</strong> further down. Moving it up here (by pay
           period) is what makes prime cost work — but remove the old
           ${wageishRows.length === 1 ? 'line' : 'lines'} when you do, or it will be
           counted twice.
         </div>`)
    : '';

  // Prime cost: food + drinks + labour, the figure restaurants actually steer
  // by. A memo line, placed after net profit so everything inside it has already
  // been shown. With no labour recorded it would be COGS wearing a different
  // name, and a "prime cost" that quietly excludes staff is worse than none —
  // so an empty labour section gets a prompt instead of a total.
  const primePct  = hasSales ? (prime / sales) * 100 : null;
  const primeVerdict = primePct == null
    ? 'Enter net sales above to see it as a percentage.'
    : primePct > 65
    ? 'Above the 60–65% of sales most restaurants aim for.'
    : primePct >= 60
    ? 'Inside the 60–65% of sales most restaurants aim for.'
    : 'Below 60% of sales — comfortable.';
  const primeRow = laborTotal > 0
    ? `<div class="pnl-row" style="align-items:flex-start;border-bottom:none;padding-top:.6rem">
         <div>
           <div class="pnl-label"><strong>Prime cost</strong>
             <span style="font-weight:400;color:var(--text-muted)">— memo, already counted above</span></div>
           <div class="pnl-sub">Food + drinks + labour. ${primeVerdict}</div>
         </div>
         <div class="pnl-amount">${fmtMoney(prime)}</div>
         <div class="pnl-pct"${primePct != null && primePct > 65 ? ' style="color:#b45309;font-weight:600"' : ''}>${pct(prime)}</div>
       </div>`
    : `<div class="pnl-sub" style="padding:.6rem .25rem .1rem">
         <i class="fas fa-circle-info"></i> Add your staff cost above to see
         <strong>prime cost</strong> — food + drinks + labour, the number most
         restaurants steer by.
       </div>`;

  const lastMonth = prevMonthStr(pnlFrom);
  const lastMonthHasOh = pnlAllOh.some(r => r.period === lastMonth);
  const periodWord = single ? 'this month' : 'this period';

  // Plain-English summary
  let plain;
  if (!hasSales) {
    plain = `<i class="fas fa-circle-info"></i> Enter your net sales for ${periodWord} above to see your profit.`;
  } else {
    const cents = Math.round((net / sales) * 100);
    plain = net >= 0
      ? `You took in <strong>${fmtMoney(sales)}</strong>. After <strong>${fmtMoney(cogsTotal + running)}</strong> in costs, you kept <strong>${fmtMoney(net)}</strong> — about <strong>${cents}¢ of every dollar</strong> you took in.`
      : `You took in <strong>${fmtMoney(sales)}</strong>, but costs were <strong>${fmtMoney(cogsTotal + running)}</strong> — a loss of <strong>${fmtMoney(-net)}</strong> over ${periodWord}.`;
  }

  // Net sales: editable for a single month (one sales_monthly row), read-only
  // sum over a longer period — you can't type one number into several months.
  // A month whose revenue came from the till is shown, not typed — two writers
  // of one number is how they end up disagreeing. The override is explicit and
  // reversible, and it says what the import reported so the difference is
  // visible rather than hidden.
  const thisMonth = single ? salesByMonth[0] : null;
  const salesCell = !single
    ? `<div style="grid-column:2/4;text-align:right">
         <div class="pnl-amount">${fmtMoney(sales)}</div>
         <div class="pnl-sub">Total of ${nMonths} months · open a single month to edit</div>
       </div>`
    : thisMonth.source === 'pos'
    ? `<div style="grid-column:2/4;text-align:right">
         <div class="pnl-amount">${fmtMoney(thisMonth.amount)}</div>
         <div class="pnl-sub">
           <i class="fas fa-cash-register"></i> From POS import · ${imported[thisMonth.month].lines} sales
           · <a href="#" onclick="pnlUseManualSales('${thisMonth.month}');return false;">use my own figure</a>
         </div>
       </div>`
    : `<div style="grid-column:2/4;text-align:right">
         <input type="number" step="0.01" min="0" id="pnlSalesInput"
                value="${thisMonth.amount ? thisMonth.amount : ''}" placeholder="0.00"
                onchange="pnlSaveSales(this.value)" />
         ${thisMonth.source === 'manual-override'
           ? `<div class="pnl-sub">Overridden · the POS import said
                ${fmtMoney(thisMonth.imported)}
                · <a href="#" onclick="pnlUseImportedSales('${thisMonth.month}');return false;">use that instead</a>
              </div>`
           : ''}
       </div>`;

  const missingSalesNote = (!single && missingSales.length)
    ? `<div class="pnl-sub" style="color:#b45309;padding:.1rem .25rem .5rem">
         <i class="fas fa-triangle-exclamation"></i> No sales entered for
         ${missingSales.map(m => esc(monthShort(m))).join(', ')} — this total is only as complete as what's been entered.
       </div>`
    : '';

  // A period in which literally nothing was recorded — no sales, no invoices, no
  // one-offs, no payroll — but which still shows a loss, because undated fixed
  // costs apply to every month there has ever been. That is how an empty January
  // reported "Net profit: −$9,670" and how Year to Date carried thousands
  // against no trading.
  //
  // Say so rather than dropping the month from the total: a month with no sales
  // is not always a month that never happened — a kitchen closed for a
  // refurbishment still pays its rent, and silently excluding it would understate
  // the year. The customer knows which of the two it was; the app does not, and
  // now has somewhere for them to say it.
  const nothingRecorded = sales <= 0 && cogsTotal <= 0 && fees <= 0 && pst <= 0 &&
                          expenseInvTotal <= 0 && ohTotal <= 0 &&
                          spreadTotal <= 0 && laborTotal <= 0;
  const emptyPeriodNote = (nothingRecorded && fixedTotal > 0)
    ? `<div class="pnl-warn">
         <i class="fas fa-circle-info"></i>
         <span>Nothing has been recorded for ${esc(periodLabel(pnlFrom, pnlTo))} — no sales, no
         invoices, no staff cost. The ${fmtMoney(fixedTotal)} below is only your fixed monthly
         costs, which apply to every month unless you say otherwise. If you weren't trading yet,
         set the month each one <strong>started</strong> in the list below.</span>
       </div>`
    : '';

  // Invoices dated in this period that are still in review. Their costs are NOT
  // in any figure on this page, so the profit shown is flattering. Say so before
  // the customer reads the number, not in a footnote under it.
  const pending = pnlCosts.pending_invoices || { count: 0, amount: 0 };
  const pendingCount = Number(pending.count) || 0;
  const pendingNote = pendingCount
    ? `<div class="pnl-warn">
         <i class="fas fa-triangle-exclamation"></i>
         <span><strong>${pendingCount} invoice${pendingCount === 1 ? '' : 's'}</strong>
         dated in ${periodWord} ${pendingCount === 1 ? 'is' : 'are'} still in review, so
         ${pendingCount === 1 ? 'its' : 'their'} cost is not counted here yet${
           pending.amount > 0 ? ` (about <strong>${fmtMoney(pending.amount)}</strong>)` : ''}.
         Your real profit is lower than the figure below.
         <a href="/invoices.html">Finish them &rarr;</a></span>
       </div>`
    : '';

  // Supplies is six built-in categories in a trench coat — packaging,
  // disposables, cleaning chemicals, linen & uniforms, smallwares, office. The
  // old label named two of them, so customers asked where their chemicals were
  // and were at risk of adding them again by hand as a one-off. Show the split.
  const suppliesBreakdown = Array.isArray(pnlCosts.supplies_breakdown) ? pnlCosts.supplies_breakdown : [];
  const suppliesRow = `
    ${costRow('Supplies &amp; non-food',
              suppliesBreakdown.length === 1
                ? `From invoices — ${esc(suppliesBreakdown[0].category)}`
                : 'From invoices — packaging, cleaning, linen, smallwares and other non-food',
              supplies)}
    ${suppliesBreakdown.length > 1 ? suppliesBreakdown.map(r => `
      <div class="pnl-row pnl-row-sub">
        <div class="pnl-label">${esc(r.category)}</div>
        <div class="pnl-amount">${fmtMoney(r.amount)}</div>
        <div class="pnl-pct">${(parseFloat(r.amount) || 0) ? pct(parseFloat(r.amount) || 0) : '—'}</div>
      </div>`).join('') : ''}`;

  // Uncategorised purchases land in food (both here and in the SQL), so a
  // half-categorised invoice run reads as a scary food-cost percentage with
  // nothing on screen explaining it.
  // "Uncategorised" includes the 'Other' bucket, which is where invoice import
  // puts anything it couldn't identify — see PLACEHOLDER_CATEGORIES in
  // src/index.ts. A mop counted as food is the case this exists to catch.
  //
  // The floor was 5% of food cost ("only worth saying when it's material") and
  // that turned out to be the wrong test. Uncategorised cost is not noise that
  // averages out — it is a wrong number sitting in a specific line, and 0.4% of
  // a real food spend is still a mop nobody will ever find by looking. The note
  // also doubles as the only prompt to finish categorising, so a floor high
  // enough to stay silent is a floor that lets the backlog grow unremarked.
  // 0.01% keeps only the guard against a rounding-dust figure that would read as
  // a bug; in practice any real stray line shows.
  //
  // Two colours, because the low floor makes one colour a lie. Amber is a
  // warning — read it as "the food-cost number above is materially wrong". A few
  // stray dollars is not that; it is a to-do. Showing both in the same amber
  // teaches customers to ignore the amber, which costs exactly when it matters.
  const UNCAT_MIN_SHARE = 0.0001;
  const UNCAT_WARN_SHARE = 0.02;
  const uncat = parseFloat(pnlCosts.food_uncategorized) || 0;
  const uncatShare = foodBought > 0 ? uncat / foodBought : 0;
  const uncatColor = uncatShare >= UNCAT_WARN_SHARE ? '#b45309' : '#6b7280';
  const uncatNote = (!useCogs && uncat > 0 && foodBought > 0 && uncatShare >= UNCAT_MIN_SHARE)
    ? `<div class="pnl-sub" style="color:${uncatColor};padding:.1rem .25rem .5rem">
         <i class="fas fa-circle-info"></i> <strong>${fmtMoney(uncat)}</strong> of this
         isn't categorised yet (it's in <em>Other</em> or blank), so it counts as food.
         Categorising it may move some cost into drinks or supplies.
         <a href="/products.html">Fix categories &rarr;</a>
       </div>`
    : '';

  // ── Cost-basis toggle (Purchases vs stock-take-adjusted True COGS) ──
  const niceDate = ymd => {
    const [y, m, d] = String(ymd || '').split('-').map(Number);
    if (!y) return '?';
    return `${d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${y}`;
  };
  let basisNote;
  if (useCogs) {
    basisNote = `<div class="pnl-basis-note"><i class="fas fa-scale-balanced"></i>
      <span>True cost of what you <strong>used</strong>: purchases adjusted by your stock counts from
      <strong>${esc(niceDate(cogsData.opening_date))}</strong> to <strong>${esc(niceDate(cogsData.closing_date))}</strong>.
      Counts the ingredients and the prep you had on hand.${pnlCarryNote(cogsData)}</span></div>`;
  } else if (cogsAvail) {
    basisNote = `<div class="pnl-basis-note"><i class="fas fa-circle-info"></i>
      <span>Showing what you <strong>bought</strong> this period. Switch to True COGS to adjust for stock you had on hand.</span></div>`;
  } else if (cogsData.reason === 'upgrade_required') {
    // Not a missing count — their plan has no stock takes at all, so telling
    // them to go and do one would send them at a screen they cannot open.
    basisNote = `<div class="pnl-basis-note warn"><i class="fas fa-lock"></i>
      <span>True COGS is part of <strong>Pro</strong>, which adds stock counting.
      Showing what you <strong>bought</strong> this period.</span></div>`;
  } else {
    // A count is the shelf before opening that day: one on the 1st opens the
    // month, and one on the 1st of the next month closes it.
    const need = cogsData.reason === 'no_opening_take'
      ? `a submitted stock take dated on or before <strong>${esc(niceDate(pnlFrom + '-01'))}</strong>`
      : `a submitted stock take dated after <strong>${esc(niceDate(pnlFrom + '-01'))}</strong> and no later than <strong>${esc(niceDate(addMonths(pnlTo, 1) + '-01'))}</strong>`;
    basisNote = `<div class="pnl-basis-note warn"><i class="fas fa-circle-info"></i>
      <span>True COGS needs ${need}. Showing purchases until then.</span></div>`;
  }

  const basisHtml = `
    <div class="pnl-basis">
      <span class="pnl-basis-label">Cost basis:</span>
      <div class="pnl-basis-seg">
        <button class="pnl-basis-btn ${!useCogs ? 'active' : ''}" onclick="pnlSetBasis('purchases')">Purchases</button>
        <button class="pnl-basis-btn ${useCogs ? 'active' : ''}" ${cogsAvail ? '' : 'disabled'}
                title="${cogsAvail ? 'Adjust purchases by stock-take inventory changes' : 'Needs bracketing stock takes'}"
                onclick="pnlSetBasis('cogs')">True COGS</button>
      </div>
      ${basisNote}
    </div>`;

  // COGS section heading + per-line detail reflect the active basis.
  const cogsHeading = useCogs ? 'Cost of goods sold — what you used' : 'Cost of goods — what you bought';
  const cogsSub = (bought, openV, closV) => useCogs
    ? `Bought ${fmtMoney(bought)} + opening ${fmtMoney(openV)}${cogsData.opening_estimate ? ' (estimated)' : ''} − closing ${fmtMoney(closV)}${cogsData.closing_estimate ? ' (estimated)' : ''}`
    : 'From invoices';

  document.getElementById('pnlBody').innerHTML = `
    <div class="pnl-period-label">Showing: <strong>${esc(periodLabel(pnlFrom, pnlTo))}</strong>${single ? '' : ` · ${nMonths} months`}</div>

    <!-- Money in -->
    <div class="pnl-row pnl-money-in">
      <div><div class="pnl-label"><strong>Net sales</strong> (money in)</div><div class="pnl-sub">What you took in after tax, discounts and refunds${single ? ' — enter it here' : ''}</div></div>
      ${salesCell}
    </div>
    ${emptyPeriodNote}
    ${missingSalesNote}
    ${pendingNote}

    ${basisHtml}

    <div class="pnl-section-head">${cogsHeading}</div>
    ${costRow('Food (ingredients)', cogsSub(foodBought, cogsData.opening_food, cogsData.closing_food), food)}
    ${uncatNote}
    ${costRow('Drinks (beverage)', cogsSub(bevBought, cogsData.opening_beverage, cogsData.closing_beverage), beverage)}
    ${wasteBlocksHtml(pnlCosts.waste, useCogs, pct, sales)}
    ${totalRow('Gross profit', gross, gross >= 0 ? 'good' : 'bad')}

    <div class="pnl-section-head">Running costs</div>

    <div class="pnl-sub" style="margin:.15rem .25rem .1rem;font-weight:600;color:var(--text)">Labour <span style="font-weight:400;color:var(--text-muted)">— staff cost per pay period, FOH and BOH, split across the months it covers</span></div>
    <div>${laborRowsHtml || '<div class="pnl-sub" style="padding:.25rem">No pay period covers this period yet.</div>'}</div>
    ${laborDoubleNote}
    <div class="pnl-oh-actions">
      <button class="btn btn-secondary btn-sm" onclick="pnlAddLabor()"><i class="fas fa-users"></i> Add pay period</button>
    </div>

    ${suppliesRow}
    ${fees ? costRow('Delivery &amp; surcharges', 'From invoices', fees) : ''}
    ${pst ? costRow(`Provincial sales tax (${taxNames().provOr})`, 'From invoices. It is not claimed back, so it is a cost', pst) : ''}
    ${expenseInv.map(r => costRow(esc(r.category), `From an uploaded bill, without its ${taxNames().fed}`, parseFloat(r.amount) || 0)).join('')}

    <div class="pnl-sub" style="margin:.9rem .25rem .1rem;font-weight:600;color:var(--text)">Fixed monthly costs <span style="font-weight:400;color:var(--text-muted)">— every month, unless you say when they start or stop</span></div>
    <div>${fixedRowsHtml || '<div class="pnl-sub" style="padding:.25rem">None set yet — add rent, wages, insurance…</div>'}</div>
    ${(!single && fixedTotal) ? `
    <div class="pnl-row" style="border-bottom:none;padding-top:.15rem">
      <div class="pnl-sub">${fixedAllMonths
        ? `${fmtMoney(fixedPerMonth)} a month × ${nMonths} months`
        : `Each cost counted only in the months it was paid`}</div>
      <div class="pnl-amount">${fmtMoney(fixedTotal)}</div>
      <div class="pnl-pct">${pct(fixedTotal)}</div>
    </div>` : ''}
    <div class="pnl-oh-actions">
      <button class="btn btn-secondary btn-sm" onclick="pnlAddRecurring()"><i class="fas fa-repeat"></i> Add fixed monthly cost</button>
    </div>

    <div class="pnl-sub" style="margin:1rem .25rem .1rem;font-weight:600;color:var(--text)">Spread costs <span style="font-weight:400;color:var(--text-muted)">— split fairly across the months they cover</span></div>
    <div>${spreadRowsHtml || '<div class="pnl-sub" style="padding:.25rem">None active this month.</div>'}</div>
    <div class="pnl-oh-actions">
      <button class="btn btn-secondary btn-sm" onclick="pnlAddSpread()"><i class="fas fa-calendar-week"></i> Add spread cost (bill covering several months)</button>
    </div>

    <div class="pnl-sub" style="margin:1rem .25rem .1rem;font-weight:600;color:var(--text)">One-off costs ${single ? 'this month' : 'in this period'}</div>
    <div>${ohRowsHtml || `<div class="pnl-sub" style="padding:.25rem">None ${single ? 'this month' : 'in this period'}.</div>`}</div>
    <div class="pnl-oh-actions">
      ${single ? `
        <button class="btn btn-secondary btn-sm" onclick="pnlAddOverhead()"><i class="fas fa-plus"></i> Add one-off cost</button>
        ${lastMonthHasOh ? `<button class="btn btn-secondary btn-sm" onclick="pnlCopyLastMonth()"><i class="fas fa-copy"></i> Copy last month's one-offs</button>` : ''}
      ` : `<div class="pnl-sub" style="padding:.25rem">Open a single month to add a one-off cost.</div>`}
    </div>

    ${totalRow('Net profit — what you keep', net, net >= 0 ? 'good' : 'bad')}
    ${primeRow}

    <div class="pnl-plain">${plain}</div>
    <div class="pnl-note">
      <i class="fas fa-circle-info"></i>
      <span>${useCogs
        ? `Food &amp; drink costs are your <strong>true cost of goods sold</strong> — purchases adjusted by the change in raw-material stock between your counts. Other running costs are what you paid in ${periodWord}. ${pnlTaxNote()}`
        : `Costs are based on what you <strong>purchased</strong> in ${periodWord} (from your invoices), not a stock-take-adjusted cost of goods sold. ${pnlTaxNote()}`}</span>
    </div>
  `;
}

// ── Exact dates: the short view (Pro) ──────────────────────────
// A week between two stock counts, or any two dates. It shows only what has its
// own day: imported till sales, food and drinks, and wages (a pay period's share
// by days). Sales typed per month, fixed monthly costs and one-offs are stored
// per month and are never split into days, so they stay on the whole-month
// statement above, which this does not change.
//
// A count is taken to be made BEFORE OPENING: counts on 7 and 14 Sep bracket
// 7..13 Sep, so a "Between counts" choice runs from one count's day to the day
// before the next. The server (/api/pnl with YYYY-MM-DD) follows the same rule.
let pnlDays      = null;      // { from, to } 'YYYY-MM-DD' inclusive; null = whole months
let pnlDayBasis  = 'cogs';    // this view shows what was USED whenever the counts allow
let pnlCountDaysLoaded = false;

function _ymdOfDayNum(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
function pnlShiftDay(ymd, n) { return _ymdOfDayNum(_dayNum(ymd) + n); }
function pnlNiceDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `${+m[3]} ${PNL_MON[+m[2] - 1]} ${m[1]}` : '?';
}

// A pay period's share of the days from..to (inclusive), by days: the same
// sum spreadAllocation() does for a month. Returns { allocated, overlapDays, totalDays }.
function dayAllocation(row, from, to) {
  const startN = _dayNum(row.start_date), endN = _dayNum(row.end_date);
  const total  = parseFloat(row.total_amount) || 0;
  if (isNaN(startN) || isNaN(endN) || endN < startN) return { allocated: 0, overlapDays: 0, totalDays: 0 };
  const oStart = Math.max(startN, _dayNum(from)), oEnd = Math.min(endN, _dayNum(to));
  const overlapDays = oEnd >= oStart ? (oEnd - oStart + 1) : 0;
  const totalDays   = endN - startN + 1;
  return { allocated: total * overlapDays / totalDays, overlapDays, totalDays };
}

// How many of the days from..to at least one pay period covers.
function daysWithWages(rows, from, to) {
  let n = 0;
  for (let d = _dayNum(from), end = _dayNum(to); d <= end; d++) {
    if (rows.some(r => _dayNum(r.start_date) <= d && d <= _dayNum(r.end_date))) n++;
  }
  return n;
}

// Consecutive counts, newest first: [{ from, to, label }]. `days` are the count
// days as the server lists them (any order).
function countPeriods(days) {
  const sorted = [...new Set(days)].sort();
  const out = [];
  for (let i = 1; i < sorted.length; i++) {
    out.push({ from: sorted[i - 1], to: pnlShiftDay(sorted[i], -1),
               label: `${pnlNiceDay(sorted[i - 1])} → ${pnlNiceDay(sorted[i])}` });
  }
  return out.reverse();
}

// When a count is not on the edge of the period (a Monday count, a month that
// ends on a Wednesday), what the server did about it, in words. Either the shelf
// on the edge was ESTIMATED (the count, plus what was bought since, less what
// sales and recorded waste used since), or it could not be, because the till
// sales for those days are not imported, and the count stands as it is.
function pnlCarryNote(c) {
  const today = new Date().toISOString().slice(0, 10);
  const est = (e, what) => ` ${what} is <strong>estimated</strong> from your ${esc(pnlNiceDay(e.from))} count:
    plus ${fmtMoney(e.bought)} bought since, less ${fmtMoney(e.used)} used by sales and recorded waste.`;
  let out = '';
  if (c.opening_estimate) out += est(c.opening_estimate, 'The stock at the start');
  if (c.closing_estimate) out += est(c.closing_estimate, 'The stock at the end');
  if (c.opening_estimate || c.closing_estimate) out += ` Stock lost with no record is not in an estimate; your next count picks it up.`;
  if (c.opening_gap) out += ` The stock at the start is your ${esc(pnlNiceDay(c.opening_gap.from))} count as it was:
    the till sales from then to the start are not imported, so it could not be brought up to the day.`;
  if (c.closing_gap) out += c.closing_gap.to >= today
    ? ` Food delivered after your ${esc(pnlNiceDay(c.closing_gap.from))} count is counted as used until your next count.`
    : ` Food delivered from ${esc(pnlNiceDay(c.closing_gap.from))} on, after your last count, is counted as <strong>used</strong>:
       the till sales for those days are not imported, so the stock at the end could not be estimated.`;
  return out;
}

// The row is for Pro (stock counts and the till import are Pro). An operator
// viewing a customer carries no plan of their own, so they are shown it too.
function pnlShowDatesBar() {
  const pro = String(window.__accountPlan || '').toLowerCase() === 'pro' || window.__isSuperAdmin === true;
  const bar = document.getElementById('pnlDatesBar');
  if (!bar) return;
  bar.classList.toggle('hidden', !pro);
  if (!pro || pnlCountDaysLoaded) return;
  pnlCountDaysLoaded = true;
  apiGet('pnl/count-days').then(r => {
    const periods = countPeriods((r && r.data) || []);
    const pick = document.getElementById('pnlCountPick');
    pick.innerHTML = periods.length
      ? `<option value="">Choose…</option>` + periods.map(p =>
          `<option value="${esc(p.from)}|${esc(p.to)}">${esc(p.label)}</option>`).join('')
      : `<option value="">Needs two stock counts</option>`;
    pick.disabled = !periods.length;
    if (pnlDays) pick.value = `${pnlDays.from}|${pnlDays.to}`;
  }).catch(() => { pnlCountDaysLoaded = false; });
}

// Which of the two sections of the period box is in use.
function pnlMarkPeriod() {
  const months = document.getElementById('pnlSecMonths'), dates = document.getElementById('pnlDatesBar');
  if (months) months.classList.toggle('active', !pnlDays);
  if (dates)  dates.classList.toggle('active', !!pnlDays);
}

function pnlSetDays(from, to) {
  pnlDays = { from, to };
  pnlDayBasis = 'cogs';
  document.getElementById('pnlDayFrom').value = from;
  document.getElementById('pnlDayTo').value   = to;
  const pick = document.getElementById('pnlCountPick');
  pick.value = `${from}|${to}`;
  if (pick.selectedIndex < 0) pick.value = '';     // dates that are not a count period
  pnlSetActivePreset(null);
  pnlMarkPeriod();
  loadPnl();
}

function pnlClearDays() {
  pnlDays = null;
  pnlMarkPeriod();
  for (const id of ['pnlDayFrom', 'pnlDayTo', 'pnlCountPick']) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }
}

function pnlApplyDays() {
  const from = document.getElementById('pnlDayFrom').value;
  const to   = document.getElementById('pnlDayTo').value;
  if (isNaN(_dayNum(from)) || isNaN(_dayNum(to))) { showToast('Pick a From and To date.', 'error'); return; }
  if (to < from) { showToast('The "To" date is before the "From" date.', 'error'); return; }
  pnlSetDays(from, to);
}

function pnlPickCounts() {
  const [from, to] = String(document.getElementById('pnlCountPick').value || '').split('|');
  if (from && to) pnlSetDays(from, to);
}

function pnlSetDayBasis(basis) {
  pnlDayBasis = (basis === 'cogs') ? 'cogs' : 'purchases';
  render();
}

function renderDays() {
  const { from, to } = pnlDays;
  const nDays = _dayNum(to) - _dayNum(from) + 1;

  // Sales: the till import only. A month's typed figure cannot be cut into days.
  const byMonth   = (pnlCosts.sales && pnlCosts.sales.by_month) || {};
  const saleLines = Object.values(byMonth).reduce((s, m) => s + (Number(m.lines) || 0), 0);
  const sales     = parseFloat(pnlCosts.sales && pnlCosts.sales.imported_total) || 0;
  const hasSales  = saleLines > 0 && sales > 0;
  const pct = n => hasSales ? Math.round((n / sales) * 100) + '%' : '—';

  const foodBought = parseFloat(pnlCosts.food_cost) || 0;
  const bevBought  = parseFloat(pnlCosts.beverage_cost) || 0;
  const cogsData   = pnlCosts.cogs || { available: false, reason: 'no_closing_take' };
  const cogsAvail  = !!cogsData.available;
  const useCogs    = pnlDayBasis === 'cogs' && cogsAvail;
  const food     = useCogs ? (parseFloat(cogsData.food_cogs) || 0) : foodBought;
  const beverage = useCogs ? (parseFloat(cogsData.beverage_cogs) || 0) : bevBought;

  // Wages: each pay period's share of these days. Days no pay period covers are
  // said out loud, never shown as $0 of wages.
  const wageRows   = pnlLabor.map(r => ({ row: r, ...dayAllocation(r, from, to) })).filter(x => x.allocated > 0.0049);
  const wages      = wageRows.reduce((s, x) => s + x.allocated, 0);
  const wageDays   = daysWithWages(pnlLabor, from, to);
  const wagesWhole = wageDays === nDays;

  const row = (label, sub, amountText, pctText) => `
    <div class="pnl-row">
      <div><div class="pnl-label">${label}</div>${sub ? `<div class="pnl-sub">${sub}</div>` : ''}</div>
      <div class="pnl-amount">${amountText}</div>
      <div class="pnl-pct">${pctText}</div>
    </div>`;
  const cogsSub = (bought, openV, closV) => useCogs
    ? `Bought ${fmtMoney(bought)} + opening ${fmtMoney(openV)}${cogsData.opening_estimate ? ' (estimated)' : ''} − closing ${fmtMoney(closV)}${cogsData.closing_estimate ? ' (estimated)' : ''}`
    : 'From invoices';
  let basisNote;
  if (useCogs) {
    basisNote = `<div class="pnl-basis-note"><i class="fas fa-scale-balanced"></i>
      <span>True cost of what you <strong>used</strong>: purchases adjusted by your stock counts of
      <strong>${esc(pnlNiceDay(cogsData.opening_date))}</strong> and <strong>${esc(pnlNiceDay(cogsData.closing_date))}</strong>,
      each taken as counted before opening.${pnlCarryNote(cogsData)}</span></div>`;
  } else if (cogsAvail) {
    basisNote = `<div class="pnl-basis-note"><i class="fas fa-circle-info"></i>
      <span>Showing what you <strong>bought</strong> in these dates. Switch to True COGS to adjust for stock you had on hand.</span></div>`;
  } else if (cogsData.reason === 'upgrade_required') {
    basisNote = `<div class="pnl-basis-note warn"><i class="fas fa-lock"></i>
      <span>True COGS is part of <strong>Pro</strong>, which adds stock counting.
      Showing what you <strong>bought</strong> in these dates.</span></div>`;
  } else {
    const need = cogsData.reason === 'no_opening_take'
      ? `a submitted stock count dated on or before <strong>${esc(pnlNiceDay(from))}</strong>`
      : `a submitted stock count dated after <strong>${esc(pnlNiceDay(from))}</strong> and no later than <strong>${esc(pnlNiceDay(pnlShiftDay(to, 1)))}</strong>`;
    basisNote = `<div class="pnl-basis-note warn"><i class="fas fa-circle-info"></i>
      <span>True COGS needs ${need}. Showing purchases until then.</span></div>`;
  }

  const pending = pnlCosts.pending_invoices || { count: 0, amount: 0 };
  const pendingCount = Number(pending.count) || 0;
  const pendingNote = pendingCount
    ? `<div class="pnl-warn">
         <i class="fas fa-triangle-exclamation"></i>
         <span><strong>${pendingCount} invoice${pendingCount === 1 ? '' : 's'}</strong>
         dated in these dates ${pendingCount === 1 ? 'is' : 'are'} still in review, so
         ${pendingCount === 1 ? 'its' : 'their'} cost is not counted here yet${
           pending.amount > 0 ? ` (about <strong>${fmtMoney(pending.amount)}</strong>)` : ''}.
         <a href="/invoices.html">Finish them &rarr;</a></span>
       </div>`
    : '';

  const wagesSub = !wageRows.length
    ? `<span style="color:#b45309">Wages are not entered for these dates. Add the pay period on the monthly statement.</span>`
    : wagesWhole
    ? `Each pay period's share of these ${nDays} days`
    : `<span style="color:#b45309">Entered for ${wageDays} of these ${nDays} days. The other days are not in yet.</span>`;

  const together = food + beverage + wages;
  const togetherRow = wageRows.length
    ? `<div class="pnl-total">
         <div class="pnl-label">Food + drinks + wages${wagesWhole ? '' : ' <span style="font-weight:400;font-size:.8rem;color:#b45309">(wages incomplete)</span>'}</div>
         <div class="pnl-amount">${fmtMoney(together)}</div>
         <div class="pnl-pct">${pct(together)}</div>
       </div>`
    : '';

  document.getElementById('pnlBody').innerHTML = `
    <div class="pnl-period-label">Showing: <strong>${esc(pnlNiceDay(from))} – ${esc(pnlNiceDay(to))}</strong> · ${nDays} day${nDays === 1 ? '' : 's'}</div>

    <div class="pnl-row pnl-money-in">
      <div><div class="pnl-label"><strong>Net sales</strong> (money in)</div>
        <div class="pnl-sub">${saleLines
          ? `<i class="fas fa-cash-register"></i> From POS import · ${saleLines} sales`
          : `<span style="color:#b45309">No sales imported for these dates, so no percentages are shown.</span>`}</div></div>
      <div style="grid-column:2/4;text-align:right"><div class="pnl-amount">${saleLines ? fmtMoney(sales) : '—'}</div></div>
    </div>
    ${pendingNote}

    <div class="pnl-basis">
      <span class="pnl-basis-label">Cost basis:</span>
      <div class="pnl-basis-seg">
        <button class="pnl-basis-btn ${!useCogs ? 'active' : ''}" onclick="pnlSetDayBasis('purchases')">Purchases</button>
        <button class="pnl-basis-btn ${useCogs ? 'active' : ''}" ${cogsAvail ? '' : 'disabled'}
                title="${cogsAvail ? 'Adjust purchases by stock-take inventory changes' : 'Needs bracketing stock takes'}"
                onclick="pnlSetDayBasis('cogs')">True COGS</button>
      </div>
      ${basisNote}
    </div>

    <div class="pnl-section-head">${useCogs ? 'Food and drinks — what you used' : 'Food and drinks — what you bought'}</div>
    ${row('Food (ingredients)', cogsSub(foodBought, cogsData.opening_food, cogsData.closing_food), fmtMoney(food), food ? pct(food) : '—')}
    ${row('Drinks (beverage)', cogsSub(bevBought, cogsData.opening_beverage, cogsData.closing_beverage), fmtMoney(beverage), beverage ? pct(beverage) : '—')}
    ${wasteBlocksHtml(pnlCosts.waste, useCogs, pct, sales)}

    <div class="pnl-section-head">Wages</div>
    ${row('Staff cost', wagesSub, wageRows.length ? fmtMoney(wages) : '—', wageRows.length ? pct(wages) : '—')}
    ${togetherRow}

    <div class="pnl-note">
      <i class="fas fa-circle-info"></i>
      <span>This is the short view for exact dates. Rent, supplies and your other costs are entered per month,
      so they are shown for whole months only, with net profit: pick a month above. Sales here are the ones
      imported from your till. Taxes and refundable deposits are excluded.</span>
    </div>
  `;
}

// ── Net sales (upsert one row per month; single-month view only) ─
async function pnlSaveSales(value) {
  const amount = parseFloat(value);
  if (isNaN(amount) || amount < 0) { showToast('Enter a valid sales amount.', 'error'); return; }
  const existing = pnlSalesRows.find(r => r.period === pnlFrom);
  try {
    if (existing) {
      await apiPatch(`tables/sales_monthly/${existing.id}`, { sales_total: amount });
      existing.sales_total = amount;
    } else {
      const row = await apiPost(`tables/sales_monthly`, { period: pnlFrom, sales_total: amount });
      pnlSalesRows.push(row);
      pnlAllSales.push(row);
    }
    showToast('Net sales saved.', 'success');
    render();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

// ── Which revenue figure this month uses ────────────────────────
// The imported total is derived from pos_sale_lines and never written here, so
// switching sources only ever flips this flag. A typed figure is preserved when
// an import takes over, and comes straight back if the user overrides — losing
// what someone entered by hand because a file arrived would be its own bug.
async function pnlSetRevenueSource(period, source) {
  try {
    const existing = pnlAllSales.find(r => r.period === period);
    if (existing) {
      await apiPatch(`tables/sales_monthly/${existing.id}`, { revenue_source: source });
      existing.revenue_source = source;
    } else {
      // No typed figure yet — create the row that carries the override.
      const row = await apiPost(`tables/sales_monthly`,
        { period, sales_total: 0, revenue_source: source });
      pnlSalesRows.push(row);
      pnlAllSales.push(row);
    }
    render();
  } catch (e) {
    showToast('Could not change the revenue source: ' + e.message, 'error');
  }
}

function pnlUseManualSales(period)   { return pnlSetRevenueSource(period, 'manual'); }
function pnlUseImportedSales(period) { return pnlSetRevenueSource(period, 'auto'); }

// ── Overheads ──────────────────────────────────────────────────
async function pnlAddOverhead() {
  try {
    const row = await apiPost(`tables/operating_expenses`, { period: pnlFrom, name: '', amount: 0 });
    pnlOverheads.push(row);
    pnlAllOh.push(row);
    render();
    // Focus the new row's name input for immediate typing
    const inputs = document.querySelectorAll('.pnl-oh-row input[type="text"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  } catch (e) {
    showToast('Could not add expense: ' + e.message, 'error');
  }
}

async function pnlUpdateOverhead(id, field, value) {
  const row = pnlOverheads.find(r => r.id === id);
  if (!row) return;
  const payload = {};
  if (field === 'amount') {
    const n = parseFloat(value);
    if (isNaN(n) || n < 0) { showToast('Enter a valid amount.', 'error'); return; }
    payload.amount = n; row.amount = n;
  } else {
    payload.name = String(value).trim(); row.name = payload.name;
  }
  try {
    await apiPatch(`tables/operating_expenses/${id}`, payload);
    render();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

async function pnlDeleteOverhead(id) {
  try {
    await apiDelete(`tables/operating_expenses/${id}`);
    pnlOverheads = pnlOverheads.filter(r => r.id !== id);
    pnlAllOh     = pnlAllOh.filter(r => r.id !== id);
    render();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

// ── Fixed monthly costs (recurring — apply from their start month on) ─────
async function pnlAddRecurring() {
  try {
    // Start it in the first month of the period being looked at. Someone
    // entering rent while viewing August means August, and someone building out
    // a March–August range means March — either way, not "every month that has
    // ever existed", which is what a blank start still means and what every row
    // used to do. It is a prefill, not a rule: the box is right there and can be
    // cleared to get the old behaviour back.
    const row = await apiPost(`tables/recurring_expenses`,
      { name: '', amount: 0, active: 1, start_period: pnlFrom });
    pnlRecurring.push(row);
    render();
    const inputs = document.querySelectorAll('.pnl-oh-row input[type="text"]');
    // The fixed-cost rows render before the one-off rows, so focus the last
    // fixed-cost input: it's at index (fixedCount - 1).
    const target = inputs[pnlRecurring.length - 1];
    if (target) target.focus();
  } catch (e) {
    showToast('Could not add fixed cost: ' + e.message, 'error');
  }
}

async function pnlUpdateRecurring(id, field, value) {
  const row = pnlRecurring.find(r => r.id === id);
  if (!row) return;
  const payload = {};
  if (field === 'amount') {
    const n = parseFloat(value);
    if (isNaN(n) || n < 0) { showToast('Enter a valid amount.', 'error'); return; }
    payload.amount = n; row.amount = n;
  } else if (field === 'start_period' || field === 'end_period') {
    // '' clears that boundary back to "no limit in this direction".
    const v = String(value || '').trim();
    if (v && !/^\d{4}-\d{2}$/.test(v)) { showToast('Enter a valid month.', 'error'); return; }
    const start = field === 'start_period' ? v : (row.start_period || '');
    const end   = field === 'end_period'   ? v : (row.end_period   || '');
    if (start && end && end < start) {
      showToast('The last month must be on or after the first month.', 'error');
      render();   // put the rejected box back to what is actually stored
      return;
    }
    payload[field] = v || null; row[field] = v || null;
  } else {
    payload.name = String(value).trim(); row.name = payload.name;
  }
  try {
    await apiPatch(`tables/recurring_expenses/${id}`, payload);
    render();

  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

async function pnlDeleteRecurring(id) {
  try {
    await apiDelete(`tables/recurring_expenses/${id}`);
    pnlRecurring = pnlRecurring.filter(r => r.id !== id);
    render();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

// ── Spread costs (one bill split across the months it covers) ──
function pnlAddSpread() {
  document.getElementById('spreadModalTitle').innerHTML = '<i class="fas fa-calendar-week"></i> Add spread cost';
  document.getElementById('spreadId').value    = '';
  document.getElementById('spreadName').value  = '';
  document.getElementById('spreadTotal').value = '';
  document.getElementById('spreadStart').value = '';
  document.getElementById('spreadEnd').value   = '';
  updateSpreadPreview();
  openModal('spreadModal');
}

function pnlEditSpread(id) {
  const r = pnlSpread.find(x => x.id === id);
  if (!r) return;
  document.getElementById('spreadModalTitle').innerHTML = '<i class="fas fa-calendar-week"></i> Edit spread cost';
  document.getElementById('spreadId').value    = r.id;
  document.getElementById('spreadName').value  = r.name || '';
  document.getElementById('spreadTotal').value = r.total_amount != null ? r.total_amount : '';
  document.getElementById('spreadStart').value = r.start_date || '';
  document.getElementById('spreadEnd').value   = r.end_date || '';
  updateSpreadPreview();
  openModal('spreadModal');
}

// Live "this month's share" hint inside the modal.
function updateSpreadPreview() {
  const el    = document.getElementById('spreadPreview');
  const total = parseFloat(document.getElementById('spreadTotal').value);
  const start = document.getElementById('spreadStart').value;
  const end   = document.getElementById('spreadEnd').value;
  if (isNaN(total) || !start || !end || _dayNum(end) < _dayNum(start)) { el.textContent = ''; return; }
  const a = spreadAllocationRange({ total_amount: total, start_date: start, end_date: end }, pnlFrom, pnlTo);
  const label = periodLabel(pnlFrom, pnlTo);
  el.innerHTML = a.allocated > 0
    ? `<i class="fas fa-scale-balanced"></i> ${label} share: <strong>${fmtMoney(a.allocated)}</strong> (${a.overlapDays} of ${a.totalDays} days)`
    : `<i class="fas fa-circle-info"></i> This range doesn't cover ${label} — it'll show in the months it does.`;
}

async function pnlSaveSpread() {
  const id    = document.getElementById('spreadId').value;
  const name  = document.getElementById('spreadName').value.trim();
  const total = parseFloat(document.getElementById('spreadTotal').value);
  const start = document.getElementById('spreadStart').value;
  const end   = document.getElementById('spreadEnd').value;
  if (!name)                         { showToast('Enter what the cost is.', 'error'); return; }
  if (isNaN(total) || total < 0)     { showToast('Enter a valid total amount.', 'error'); return; }
  if (!start || !end)                { showToast('Enter the start and end dates.', 'error'); return; }
  if (_dayNum(end) < _dayNum(start)) { showToast('End date must be on or after the start date.', 'error'); return; }

  const payload = { name, total_amount: total, start_date: start, end_date: end };
  const btn = document.getElementById('saveSpreadBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    if (id) await apiPatch(`tables/spread_expenses/${id}`, payload);
    else    await apiPost(`tables/spread_expenses`, payload);
    showToast('Spread cost saved.', 'success');
    closeModal('spreadModal');
    await loadPnl();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save';
  }
}

async function pnlDeleteSpread(id) {
  const r = pnlSpread.find(x => x.id === id);
  if (!confirm(`Remove "${r ? (r.name || 'this spread cost') : 'this spread cost'}"? It will be removed from every month it covered.`)) return;
  try {
    await apiDelete(`tables/spread_expenses/${id}`);
    pnlSpread = pnlSpread.filter(x => x.id !== id);
    render();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

// ── Labour (staff cost for one pay period) ──
// Stored and prorated exactly like a spread cost, so the modal mirrors that one.
// The dates are the point: payroll runs rarely line up with calendar months, and
// a fortnight ending 5 Sep belongs partly to August.
function pnlAddLabor() {
  document.getElementById('laborModalTitle').innerHTML = '<i class="fas fa-users"></i> Add pay period';
  document.getElementById('laborId').value    = '';
  document.getElementById('laborName').value  = '';
  document.getElementById('laborTotal').value = '';
  document.getElementById('laborStart').value = '';
  document.getElementById('laborEnd').value   = '';
  updateLaborPreview();
  openModal('laborModal');
}

function pnlEditLabor(id) {
  const r = pnlLabor.find(x => x.id === id);
  if (!r) return;
  document.getElementById('laborModalTitle').innerHTML = '<i class="fas fa-users"></i> Edit pay period';
  document.getElementById('laborId').value    = r.id;
  document.getElementById('laborName').value  = r.name || '';
  document.getElementById('laborTotal').value = r.total_amount != null ? r.total_amount : '';
  document.getElementById('laborStart').value = r.start_date || '';
  document.getElementById('laborEnd').value   = r.end_date || '';
  updateLaborPreview();
  openModal('laborModal');
}

// Pay periods already on file whose dates touch start..end, newest first.
// `excludeId` is the row being edited — re-saving it must not warn about itself.
//
// Entering payroll is the most repetitive job on this page (26 times a year,
// always the same shape), which makes it the one most likely to be entered
// twice; and labour is the biggest number here, so a duplicate does more damage
// than a duplicate anywhere else. A duplicated August fortnight took $23,800 off
// the month's profit with nothing on screen to say why.
//
// pnlLabor holds EVERY pay period, not just the ones in view, so a clash with a
// fortnight outside the current month is still caught.
function pnlOverlappingLabor(start, end, excludeId) {
  const s = _dayNum(start), e = _dayNum(end);
  if (isNaN(s) || isNaN(e)) return [];
  return pnlLabor.filter(r => {
    if (!r.start_date || !r.end_date) return false;
    if (excludeId && r.id === excludeId) return false;
    return _dayNum(r.start_date) <= e && s <= _dayNum(r.end_date);
  });
}

// An exact repeat — same dates, same money — is almost certainly the same pay
// run entered twice. A partial overlap is a different thing: splitting kitchen
// and front of house into two rows for one fortnight is legitimate. Both are
// worth mentioning, but only one of them should sound like a mistake.
function _isSameLaborRun(r, start, end, total) {
  return r.start_date === start && r.end_date === end &&
         Math.abs((parseFloat(r.total_amount) || 0) - total) < 0.005;
}

// One sentence naming what the new row clashes with. Null when nothing does.
function pnlLaborClashNote(start, end, total, excludeId) {
  const clashes = pnlOverlappingLabor(start, end, excludeId);
  if (!clashes.length) return null;
  const dup   = !isNaN(total) && clashes.find(r => _isSameLaborRun(r, start, end, total));
  const first = dup || clashes[0];
  const label = `${first.name ? `"${first.name}" · ` : ''}${spreadRangeLabel(first)} · ${fmtMoney(first.total_amount)}`;
  const more  = clashes.length > 1 ? ` (and ${clashes.length - 1} more)` : '';
  return dup
    ? `You already have an identical pay period: ${label}${more}. Saving this adds it a second time.`
    : `This overlaps a pay period you already have: ${label}${more}. That is fine if you are splitting one pay run across two rows — otherwise the staff cost is counted twice.`;
}

// Live "this period's share" hint — the whole reason the dates exist, so it is
// worth showing before they save rather than after. Doubles as the place the
// overlap warning appears, so the clash is visible while the dates are still
// under the cursor rather than only at the moment of saving.
function updateLaborPreview() {
  const el    = document.getElementById('laborPreview');
  const total = parseFloat(document.getElementById('laborTotal').value);
  const start = document.getElementById('laborStart').value;
  const end   = document.getElementById('laborEnd').value;

  const warnEl = document.getElementById('laborOverlapWarn');
  const clash  = (start && end && _dayNum(end) >= _dayNum(start))
    ? pnlLaborClashNote(start, end, total, document.getElementById('laborId').value)
    : null;
  if (clash) {
    warnEl.classList.remove('hidden');
    warnEl.innerHTML = `<i class="fas fa-triangle-exclamation"></i> ${esc(clash)}`;
  } else {
    warnEl.classList.add('hidden');
    warnEl.textContent = '';
  }

  if (isNaN(total) || !start || !end || _dayNum(end) < _dayNum(start)) { el.textContent = ''; return; }
  const a = spreadAllocationRange({ total_amount: total, start_date: start, end_date: end }, pnlFrom, pnlTo);
  const label = periodLabel(pnlFrom, pnlTo);
  el.innerHTML = a.allocated > 0
    ? `<i class="fas fa-scale-balanced"></i> ${label} share: <strong>${fmtMoney(a.allocated)}</strong> (${a.overlapDays} of ${a.totalDays} days)`
    : `<i class="fas fa-circle-info"></i> This pay period doesn't touch ${label} — it'll show in the months it does.`;
}

async function pnlSaveLabor() {
  const id    = document.getElementById('laborId').value;
  const name  = document.getElementById('laborName').value.trim();
  const total = parseFloat(document.getElementById('laborTotal').value);
  const start = document.getElementById('laborStart').value;
  const end   = document.getElementById('laborEnd').value;
  if (isNaN(total) || total < 0)     { showToast('Enter a valid staff cost.', 'error'); return; }
  if (!start || !end)                { showToast('Enter the pay period start and end dates.', 'error'); return; }
  if (_dayNum(end) < _dayNum(start)) { showToast('End date must be on or after the start date.', 'error'); return; }

  // Warn, never block: two rows for one fortnight is a legitimate way to split
  // kitchen from front of house, and refusing it would send someone off adding
  // their payroll together by hand. The amber note in the modal has already said
  // this; the confirm is the last chance to notice it.
  const clash = pnlLaborClashNote(start, end, total, id);
  if (clash && !confirm(`${clash}\n\nSave it anyway?`)) return;

  // Unnamed is fine — the row falls back to "Pay period" and prints the dates
  // underneath, so auto-filling the range into the name only says it twice.
  const payload = { name, total_amount: total, start_date: start, end_date: end };
  const btn = document.getElementById('saveLaborBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    if (id) await apiPatch(`tables/labor_periods/${id}`, payload);
    else    await apiPost(`tables/labor_periods`, payload);
    showToast('Staff cost saved.', 'success');
    closeModal('laborModal');
    await loadPnl();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save';
  }
}

async function pnlDeleteLabor(id) {
  const r = pnlLabor.find(x => x.id === id);
  if (!confirm(`Remove "${r ? (r.name || 'this pay period') : 'this pay period'}"? It will be removed from every month it covered.`)) return;
  try {
    await apiDelete(`tables/labor_periods/${id}`);
    pnlLabor = pnlLabor.filter(x => x.id !== id);
    render();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

async function pnlCopyLastMonth() {
  const lastMonth = prevMonthStr(pnlFrom);
  const prev = pnlAllOh.filter(r => r.period === lastMonth);
  if (!prev.length) { showToast('No expenses to copy from last month.', 'warning'); return; }
  try {
    for (const r of prev) {
      const row = await apiPost(`tables/operating_expenses`, {
        period: pnlFrom, name: r.name || '', amount: parseFloat(r.amount) || 0,
      });
      pnlOverheads.push(row);
      pnlAllOh.push(row);
    }
    showToast(`Copied ${prev.length} expense${prev.length === 1 ? '' : 's'} from last month.`, 'success');
    render();
  } catch (e) {
    showToast('Copy failed: ' + e.message, 'error');
  }
}
