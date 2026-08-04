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

  const start = pnlPresetRange('this-month');
  pnlSetRange(start.from, start.to);   // loads
});

// ── Load ───────────────────────────────────────────────────────
async function loadPnl() {
  const body = document.getElementById('pnlBody');
  body.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:2rem 1rem"><i class="fas fa-spinner fa-spin"></i> Loading…</div>`;
  try {
    const [costs, salesData, ohData, recData, spData] = await Promise.all([
      apiGet(`pnl?from=${pnlFrom}&to=${pnlTo}`),
      apiGet(`tables/sales_monthly?page=1&limit=500`),
      apiGet(`tables/operating_expenses?page=1&limit=1000`),
      apiGet(`tables/recurring_expenses?page=1&limit=500`),
      apiGet(`tables/spread_expenses?page=1&limit=500`),
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
    render();
  } catch (e) {
    body.innerHTML = `<div style="text-align:center;color:#b91c1c;padding:2rem 1rem"><i class="fas fa-exclamation-triangle"></i> Failed to load P&amp;L: ${esc(e.message)}</div>`;
  }
}

// ── Render ─────────────────────────────────────────────────────
function fmtMoney(n) {
  const num = parseFloat(n) || 0;
  return (num < 0 ? '-$' : '$') + Math.abs(num).toFixed(2);
}

// Whole-day number for a 'YYYY-MM-DD' string (UTC-based, DST-safe).
function _dayNum(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

// Fair share of a spread cost that falls inside `month` ('YYYY-MM'): the total
// prorated by how many days of [start_date, end_date] land in that month.
// Returns { allocated, overlapDays, totalDays }.
function spreadAllocation(row, month) {
  const startN = _dayNum(row.start_date);
  const endN   = _dayNum(row.end_date);
  const total  = parseFloat(row.total_amount) || 0;
  if (isNaN(startN) || isNaN(endN) || endN < startN) return { allocated: 0, overlapDays: 0, totalDays: 0 };

  const [y, m]  = month.split('-').map(Number);
  const mStartN = Math.floor(Date.UTC(y, m - 1, 1) / 86400000);
  const mEndN   = Math.floor(Date.UTC(y, m, 1) / 86400000) - 1;   // last day of month

  const oStart = Math.max(startN, mStartN);
  const oEnd   = Math.min(endN, mEndN);
  const overlapDays = oEnd >= oStart ? (oEnd - oStart + 1) : 0;
  const totalDays   = endN - startN + 1;
  return { allocated: totalDays > 0 ? total * overlapDays / totalDays : 0, overlapDays, totalDays };
}

// A spread cost's share of a whole period = the sum of its monthly shares.
function spreadAllocationRange(row, from, to) {
  let allocated = 0, overlapDays = 0, totalDays = 0;
  for (const m of monthsInRange(from, to)) {
    const a = spreadAllocation(row, m);
    allocated += a.allocated; overlapDays += a.overlapDays; totalDays = a.totalDays;
  }
  return { allocated, overlapDays, totalDays };
}

// Short human range label, e.g. "13 Jun – 18 Sep 2026".
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
  const months   = monthsInRange(pnlFrom, pnlTo);
  const nMonths  = months.length;
  const single   = pnlFrom === pnlTo;     // month-scoped edits only make sense here
  // ── Revenue: imported wins, unless the month was explicitly overridden ──
  // Resolved PER MONTH, not for the period as a whole, so a range where some
  // months were imported and others typed in still totals correctly.
  const imported = (pnlCosts.sales && pnlCosts.sales.by_month) || {};
  const salesFor = (m) => {
    const row  = pnlSalesRows.find(r => r.period === m);
    const typed = parseFloat(row && row.sales_total) || 0;
    const imp   = parseFloat(imported[m] && imported[m].imported_net) || 0;
    const overridden = !!row && row.revenue_source === 'manual';
    if (imp > 0 && !overridden) return { amount: imp, source: 'pos', typed, imported: imp, row };
    return { amount: typed, source: overridden && imp > 0 ? 'manual-override' : 'manual',
             typed, imported: imp, row };
  };
  const salesByMonth = months.map(m => ({ month: m, ...salesFor(m) }));
  const sales = salesByMonth.reduce((s, x) => s + x.amount, 0);
  const foodBought = parseFloat(pnlCosts.food_cost) || 0;
  const bevBought  = parseFloat(pnlCosts.beverage_cost) || 0;
  const supplies = parseFloat(pnlCosts.supplies_cost) || 0;

  // Cost basis: purchases (what you bought) vs stock-take-adjusted true COGS.
  const cogsData  = pnlCosts.cogs || { available: false, reason: 'no_closing_take' };
  const cogsAvail = !!cogsData.available;
  const useCogs   = pnlBasis === 'cogs' && cogsAvail;
  const food     = useCogs ? (parseFloat(cogsData.food_cogs) || 0) : foodBought;
  const beverage = useCogs ? (parseFloat(cogsData.beverage_cogs) || 0) : bevBought;
  const fees     = parseFloat(pnlCosts.invoice_fees) || 0;
  const ohTotal  = pnlOverheads.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  // Fixed costs are per month, so a 3-month period carries 3× the rent.
  const fixedPerMonth = pnlRecurring.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const fixedTotal    = fixedPerMonth * nMonths;
  // Spread costs: the period's fair share of each multi-month bill.
  const spreadThisMonth = pnlSpread
    .map(r => ({ row: r, ...spreadAllocationRange(r, pnlFrom, pnlTo) }))
    .filter(x => x.allocated > 0.0049);
  const spreadTotal = spreadThisMonth.reduce((s, x) => s + x.allocated, 0);
  // Months with no revenue at all — a period total silently understates without
  // this. A month covered by a POS import is not missing, however it got there.
  const missingSales = salesByMonth.filter(x => x.amount <= 0).map(x => x.month);
  // Expense invoices (utilities/rent/etc.) uploaded and classified as expenses.
  const expenseInv = pnlCosts.expense_invoices || [];
  const expenseInvTotal = expenseInv.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  const cogsTotal = food + beverage;
  const gross   = sales - cogsTotal;
  const running = supplies + fees + expenseInvTotal + fixedTotal + spreadTotal + ohTotal;
  const net     = gross - running;
  const hasSales = sales > 0;

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

  // Fixed monthly cost rows (recurring — same every month, editable)
  const fixedRowsHtml = pnlRecurring.map(r => `
    <div class="pnl-oh-row">
      <input type="text" value="${esc(r.name || '')}" placeholder="e.g. Rent, Wages, Insurance"
             onchange="pnlUpdateRecurring('${esc(r.id)}','name',this.value)" />
      <input type="number" step="0.01" min="0" value="${r.amount != null ? r.amount : ''}" placeholder="0.00"
             onchange="pnlUpdateRecurring('${esc(r.id)}','amount',this.value)" />
      <button class="pnl-oh-del" title="Remove" onclick="pnlDeleteRecurring('${esc(r.id)}')"><i class="fas fa-times"></i></button>
    </div>`).join('');

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
  // nothing on screen explaining it. Only worth saying when it's material.
  const uncat = parseFloat(pnlCosts.food_uncategorized) || 0;
  const uncatNote = (!useCogs && uncat > 0 && foodBought > 0 && uncat / foodBought >= 0.05)
    ? `<div class="pnl-sub" style="color:#b45309;padding:.1rem .25rem .5rem">
         <i class="fas fa-circle-info"></i> <strong>${fmtMoney(uncat)}</strong> of this
         has no category yet, so it counts as food. Categorising it may move cost
         into drinks or supplies.
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
      Raw-material inventory only.</span></div>`;
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
    const need = cogsData.reason === 'no_opening_take'
      ? `a submitted stock take dated before <strong>${esc(niceDate(pnlFrom + '-01'))}</strong>`
      : `a submitted stock take dated within this period`;
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
    ? `Bought ${fmtMoney(bought)} + opening ${fmtMoney(openV)} − closing ${fmtMoney(closV)}`
    : 'From invoices';

  document.getElementById('pnlBody').innerHTML = `
    <div class="pnl-period-label">Showing: <strong>${esc(periodLabel(pnlFrom, pnlTo))}</strong>${single ? '' : ` · ${nMonths} months`}</div>

    <!-- Money in -->
    <div class="pnl-row pnl-money-in">
      <div><div class="pnl-label"><strong>Net sales</strong> (money in)</div><div class="pnl-sub">What you took in after tax, discounts and refunds${single ? ' — enter it here' : ''}</div></div>
      ${salesCell}
    </div>
    ${missingSalesNote}
    ${pendingNote}

    ${basisHtml}

    <div class="pnl-section-head">${cogsHeading}</div>
    ${costRow('Food (ingredients)', cogsSub(foodBought, cogsData.opening_food, cogsData.closing_food), food)}
    ${uncatNote}
    ${costRow('Drinks (beverage)', cogsSub(bevBought, cogsData.opening_beverage, cogsData.closing_beverage), beverage)}
    ${totalRow('Gross profit', gross, gross >= 0 ? 'good' : 'bad')}

    <div class="pnl-section-head">Running costs</div>
    ${suppliesRow}
    ${fees ? costRow('Delivery &amp; surcharges', 'From invoices', fees) : ''}
    ${expenseInv.map(r => costRow(esc(r.category), 'From an uploaded bill', parseFloat(r.amount) || 0)).join('')}

    <div class="pnl-sub" style="margin:.9rem .25rem .1rem;font-weight:600;color:var(--text)">Fixed monthly costs <span style="font-weight:400;color:var(--text-muted)">— same every month</span></div>
    <div>${fixedRowsHtml || '<div class="pnl-sub" style="padding:.25rem">None set yet — add rent, wages, insurance…</div>'}</div>
    ${(!single && fixedPerMonth) ? `
    <div class="pnl-row" style="border-bottom:none;padding-top:.15rem">
      <div class="pnl-sub">${fmtMoney(fixedPerMonth)} a month × ${nMonths} months</div>
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

    <div class="pnl-plain">${plain}</div>
    <div class="pnl-note">
      <i class="fas fa-circle-info"></i>
      <span>${useCogs
        ? `Food &amp; drink costs are your <strong>true cost of goods sold</strong> — purchases adjusted by the change in raw-material stock between your counts. Other running costs are what you paid in ${periodWord}. Taxes and refundable deposits are excluded.`
        : `Costs are based on what you <strong>purchased</strong> in ${periodWord} (from your invoices), not a stock-take-adjusted cost of goods sold. Taxes and refundable deposits are excluded.`}</span>
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

// ── Fixed monthly costs (recurring — apply to every month) ─────
async function pnlAddRecurring() {
  try {
    const row = await apiPost(`tables/recurring_expenses`, { name: '', amount: 0, active: 1 });
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
