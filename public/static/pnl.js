/* ===== pnl.js — Profit & Loss (Phase 1) ===== */
// Cost side comes from /api/pnl (invoices, by category type). Sales + overheads
// are manual, stored in sales_monthly / operating_expenses via generic CRUD.

let pnlMonth      = '';     // 'YYYY-MM'
let pnlCosts      = { food_cost: 0, beverage_cost: 0, supplies_cost: 0, invoice_fees: 0 };
let pnlSalesRow   = null;   // sales_monthly row for the month (or null)
let pnlOverheads  = [];     // operating_expenses rows for the month (one-offs)
let pnlRecurring  = [];     // recurring_expenses rows (fixed monthly costs — every month)
let pnlAllSales   = [];     // all sales_monthly rows (cache)
let pnlAllOh      = [];     // all operating_expenses rows (cache — for copy-last-month)

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('pnl-page-marker')) return;
  const now = new Date();
  pnlMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  document.getElementById('pnlMonth').value = pnlMonth;

  document.getElementById('pnlMonth').addEventListener('change', e => {
    if (/^\d{4}-\d{2}$/.test(e.target.value)) { pnlMonth = e.target.value; loadPnl(); }
  });
  document.getElementById('pnlPrev').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('pnlNext').addEventListener('click', () => shiftMonth(1));

  loadPnl();
});

function shiftMonth(delta) {
  const [y, m] = pnlMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  pnlMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  document.getElementById('pnlMonth').value = pnlMonth;
  loadPnl();
}

function prevMonthStr(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Load ───────────────────────────────────────────────────────
async function loadPnl() {
  const body = document.getElementById('pnlBody');
  body.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:2rem 1rem"><i class="fas fa-spinner fa-spin"></i> Loading…</div>`;
  try {
    const [costs, salesData, ohData, recData] = await Promise.all([
      apiGet(`pnl?month=${pnlMonth}`),
      apiGet(`tables/sales_monthly?page=1&limit=500`),
      apiGet(`tables/operating_expenses?page=1&limit=1000`),
      apiGet(`tables/recurring_expenses?page=1&limit=500`),
    ]);
    pnlCosts     = costs || pnlCosts;
    pnlAllSales  = salesData.data || [];
    pnlAllOh     = ohData.data || [];
    pnlSalesRow  = pnlAllSales.find(r => r.period === pnlMonth) || null;
    pnlOverheads = pnlAllOh.filter(r => r.period === pnlMonth)
      .sort((a, b) => (a.created_at || '') < (b.created_at || '') ? -1 : 1);
    pnlRecurring = (recData.data || [])
      .filter(r => r.active == null || Number(r.active) === 1)
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

function render() {
  const sales    = parseFloat(pnlSalesRow?.sales_total) || 0;
  const food     = parseFloat(pnlCosts.food_cost) || 0;
  const beverage = parseFloat(pnlCosts.beverage_cost) || 0;
  const supplies = parseFloat(pnlCosts.supplies_cost) || 0;
  const fees     = parseFloat(pnlCosts.invoice_fees) || 0;
  const ohTotal  = pnlOverheads.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const fixedTotal = pnlRecurring.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  const cogs    = food + beverage;
  const gross   = sales - cogs;
  const running = supplies + fees + fixedTotal + ohTotal;
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

  // Fixed monthly cost rows (recurring — same every month, editable)
  const fixedRowsHtml = pnlRecurring.map(r => `
    <div class="pnl-oh-row">
      <input type="text" value="${esc(r.name || '')}" placeholder="e.g. Rent, Wages, Insurance"
             onchange="pnlUpdateRecurring('${esc(r.id)}','name',this.value)" />
      <input type="number" step="0.01" min="0" value="${r.amount != null ? r.amount : ''}" placeholder="0.00"
             onchange="pnlUpdateRecurring('${esc(r.id)}','amount',this.value)" />
      <button class="pnl-oh-del" title="Remove" onclick="pnlDeleteRecurring('${esc(r.id)}')"><i class="fas fa-times"></i></button>
    </div>`).join('');

  // Manual one-off overhead rows (editable)
  const ohRowsHtml = pnlOverheads.map(r => `
    <div class="pnl-oh-row">
      <input type="text" value="${esc(r.name || '')}" placeholder="Expense name"
             onchange="pnlUpdateOverhead('${esc(r.id)}','name',this.value)" />
      <input type="number" step="0.01" min="0" value="${r.amount != null ? r.amount : ''}" placeholder="0.00"
             onchange="pnlUpdateOverhead('${esc(r.id)}','amount',this.value)" />
      <button class="pnl-oh-del" title="Remove" onclick="pnlDeleteOverhead('${esc(r.id)}')"><i class="fas fa-times"></i></button>
    </div>`).join('');

  const lastMonth = prevMonthStr(pnlMonth);
  const lastMonthHasOh = pnlAllOh.some(r => r.period === lastMonth);

  // Plain-English summary
  let plain;
  if (!hasSales) {
    plain = `<i class="fas fa-circle-info"></i> Enter your sales for this month above to see your profit.`;
  } else {
    const cents = Math.round((net / sales) * 100);
    plain = net >= 0
      ? `You took in <strong>${fmtMoney(sales)}</strong>. After <strong>${fmtMoney(cogs + running)}</strong> in costs, you kept <strong>${fmtMoney(net)}</strong> — about <strong>${cents}¢ of every dollar</strong> you took in.`
      : `You took in <strong>${fmtMoney(sales)}</strong>, but costs were <strong>${fmtMoney(cogs + running)}</strong> — a loss of <strong>${fmtMoney(-net)}</strong> this month.`;
  }

  document.getElementById('pnlBody').innerHTML = `
    <!-- Money in -->
    <div class="pnl-row pnl-money-in">
      <div><div class="pnl-label"><strong>Sales</strong> (money in)</div><div class="pnl-sub">What you took in this month — enter it here</div></div>
      <div style="grid-column:2/4;text-align:right">
        <input type="number" step="0.01" min="0" id="pnlSalesInput"
               value="${sales ? sales : ''}" placeholder="0.00"
               onchange="pnlSaveSales(this.value)" />
      </div>
    </div>

    <div class="pnl-section-head">Cost of goods — what you sold</div>
    ${costRow('Food (ingredients)', '', food)}
    ${costRow('Drinks (beverage)', '', beverage)}
    ${totalRow('Gross profit', gross, gross >= 0 ? 'good' : 'bad')}

    <div class="pnl-section-head">Running costs</div>
    ${costRow('Packaging &amp; supplies', 'From invoices', supplies)}
    ${fees ? costRow('Delivery &amp; surcharges', 'From invoices', fees) : ''}

    <div class="pnl-sub" style="margin:.9rem .25rem .1rem;font-weight:600;color:var(--text)">Fixed monthly costs <span style="font-weight:400;color:var(--text-muted)">— same every month</span></div>
    <div>${fixedRowsHtml || '<div class="pnl-sub" style="padding:.25rem">None set yet — add rent, wages, insurance…</div>'}</div>
    <div class="pnl-oh-actions">
      <button class="btn btn-secondary btn-sm" onclick="pnlAddRecurring()"><i class="fas fa-repeat"></i> Add fixed monthly cost</button>
    </div>

    <div class="pnl-sub" style="margin:1rem .25rem .1rem;font-weight:600;color:var(--text)">One-off costs this month</div>
    <div>${ohRowsHtml || '<div class="pnl-sub" style="padding:.25rem">None this month.</div>'}</div>
    <div class="pnl-oh-actions">
      <button class="btn btn-secondary btn-sm" onclick="pnlAddOverhead()"><i class="fas fa-plus"></i> Add one-off cost</button>
      ${lastMonthHasOh ? `<button class="btn btn-secondary btn-sm" onclick="pnlCopyLastMonth()"><i class="fas fa-copy"></i> Copy last month's one-offs</button>` : ''}
    </div>

    ${totalRow('Net profit — what you keep', net, net >= 0 ? 'good' : 'bad')}

    <div class="pnl-plain">${plain}</div>
    <div class="pnl-note">
      <i class="fas fa-circle-info"></i>
      <span>Costs are based on what you <strong>purchased</strong> this month (from your invoices), not a stock-take-adjusted cost of goods sold. Taxes and refundable deposits are excluded.</span>
    </div>
  `;
}

// ── Sales (upsert one row per month) ───────────────────────────
async function pnlSaveSales(value) {
  const amount = parseFloat(value);
  if (isNaN(amount) || amount < 0) { showToast('Enter a valid sales amount.', 'error'); return; }
  try {
    if (pnlSalesRow) {
      await apiPatch(`tables/sales_monthly/${pnlSalesRow.id}`, { sales_total: amount });
      pnlSalesRow.sales_total = amount;
    } else {
      pnlSalesRow = await apiPost(`tables/sales_monthly`, { period: pnlMonth, sales_total: amount });
      pnlAllSales.push(pnlSalesRow);
    }
    showToast('Sales saved.', 'success');
    render();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

// ── Overheads ──────────────────────────────────────────────────
async function pnlAddOverhead() {
  try {
    const row = await apiPost(`tables/operating_expenses`, { period: pnlMonth, name: '', amount: 0 });
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

async function pnlCopyLastMonth() {
  const lastMonth = prevMonthStr(pnlMonth);
  const prev = pnlAllOh.filter(r => r.period === lastMonth);
  if (!prev.length) { showToast('No expenses to copy from last month.', 'warning'); return; }
  try {
    for (const r of prev) {
      const row = await apiPost(`tables/operating_expenses`, {
        period: pnlMonth, name: r.name || '', amount: parseFloat(r.amount) || 0,
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
