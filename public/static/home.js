/* ===== home.js — Price Movers page ===== */

let pmData = [];           // full products array from /api/price-movers
let pmSelectedId = null;   // currently selected product id
let pmChart = null;        // Chart.js instance
let pmSuggestBlur;         // timer id for suggestion dismissal
let sbChart = null;
let sbActivePreset = null;
let sbView = 'category';
let sbData = null;

// ── Date helpers ──────────────────────────────────────────────
function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return s;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

// ── Vendor color palette (stable assignment by vendor name) ──
const VENDOR_PALETTE = [
  '#4f46e5', '#059669', '#dc2626', '#d97706', '#0891b2',
  '#7c3aed', '#db2777', '#2563eb', '#65a30d', '#ea580c',
  '#0d9488', '#9333ea', '#be123c'
];
const _vendorColorCache = new Map();
function vendorColor(vendor) {
  const key = (vendor || '—').trim() || '—';
  if (_vendorColorCache.has(key)) return _vendorColorCache.get(key);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const color = VENDOR_PALETTE[hash % VENDOR_PALETTE.length];
  _vendorColorCache.set(key, color);
  return color;
}

// ── Change class & formatting ────────────────────────────────
function changeClass(pct) {
  if (pct === null || pct === undefined) return 'flat';
  if (pct > 0.05)  return 'up';
  if (pct < -0.05) return 'down';
  return 'flat';
}
function formatPct(pct) {
  if (pct === null || pct === undefined) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

// ── Fetch + state ────────────────────────────────────────────
async function loadMovers() {
  const from = document.getElementById('pmFrom').value;
  const to   = document.getElementById('pmTo').value;
  const listEl = document.getElementById('pmList');
  listEl.innerHTML = '<div class="pm-empty"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';

  try {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to', to);
    const r = await apiGet(`price-movers?${qs.toString()}`);
    pmData = r.data || [];
  } catch (e) {
    listEl.innerHTML = `<div class="pm-empty" style="color:var(--danger)">Failed to load: ${esc(e.message || e)}</div>`;
    return;
  }

  renderList();

  // Keep the currently selected product if still in the new data, else pick #1.
  if (pmSelectedId && pmData.some(p => p.product_id === pmSelectedId)) {
    renderDetail(pmData.find(p => p.product_id === pmSelectedId));
  } else {
    const top = pmData.filter(p => p.pct_change !== null)[0];
    if (top) {
      pmSelectedId = top.product_id;
      renderList();
      renderDetail(top);
    } else {
      pmSelectedId = null;
      clearDetail();
    }
  }
}

function renderList() {
  const listEl = document.getElementById('pmList');
  const movers = pmData.filter(p => p.pct_change !== null).slice(0, 10);
  if (!movers.length) {
    listEl.innerHTML = '<div class="pm-empty">No products with at least 2 purchases in this range.</div>';
    return;
  }

  listEl.innerHTML = movers.map(p => {
    const cls = changeClass(p.pct_change);
    // pct_change is computed from the two most recent purchases that could both
    // be expressed in the stocking unit — show those same two, or the figures
    // won't reconcile with the percentage next to them.
    const cmp    = p.purchases.filter(x => x.cost_per_stock_unit != null);
    const latest = cmp[0] || p.purchases[0];
    const prev   = cmp[1] || p.purchases[1];
    const selected = p.product_id === pmSelectedId ? ' selected' : '';
    const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '▸';

    // A supplier switch or a substituted item isn't a price move. Say which it
    // is, so the number doesn't read as "this vendor put their prices up".
    const isSwitch = p.change_kind === 'supplier' || p.change_kind === 'item';
    const switchNote = p.change_kind === 'supplier'
      ? `<div class="pm-switch"><i class="fas fa-right-left"></i> switched vendor · ${esc(p.change_from)} → ${esc(p.change_to)}</div>`
      : p.change_kind === 'item'
        ? `<div class="pm-switch"><i class="fas fa-shuffle"></i> different item · ${esc(p.change_from)} → ${esc(p.change_to)}</div>`
        : '';

    return `
      <div class="pm-row ${isSwitch ? 'switch' : cls}${selected}" data-id="${esc(p.product_id)}">
        <div>
          <div class="pm-name">${esc(p.product_name)}</div>
          <div class="pm-meta">
            ${fmt(latest.cost_per_stock_unit ?? latest.cost_per_unit)}/${esc(p.unit || 'unit')}
            <span style="color:var(--text-muted)"> · prev ${fmt(prev.cost_per_stock_unit ?? prev.cost_per_unit)}</span>
          </div>
          ${switchNote}
        </div>
        <div class="pm-change ${isSwitch ? 'switch' : cls}" title="${isSwitch ? 'Difference between two different purchases, not a price change by one vendor' : 'Price change'}">
          ${isSwitch ? '⇄' : arrow} ${formatPct(p.pct_change)}
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.pm-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.getAttribute('data-id');
      const prod = pmData.find(p => p.product_id === id);
      if (prod) {
        pmSelectedId = id;
        renderList();
        renderDetail(prod);
      }
    });
  });
}

// ── Selected-product rendering ───────────────────────────────
function clearDetail() {
  document.getElementById('pmChartTitle').textContent = 'Select a product';
  document.getElementById('pmChartSub').textContent = 'Click any row on the left to see its last 10 purchases.';
  document.getElementById('pmChartChange').textContent = '';
  document.getElementById('pmChartChange').className = 'pm-chart-change';
  document.getElementById('pmWarning').classList.add('hidden');
  document.getElementById('pmVendorLegend').innerHTML = '';
  document.getElementById('pmDetailBody').innerHTML =
    '<tr><td colspan="4" class="empty-row">Select a product to see its purchase history.</td></tr>';
  document.getElementById('pmChartPlaceholder').classList.remove('hidden');
  if (pmChart) { pmChart.destroy(); pmChart = null; }
}

function renderDetail(product) {
  const warningEl = document.getElementById('pmWarning');
  const titleEl   = document.getElementById('pmChartTitle');
  const subEl     = document.getElementById('pmChartSub');
  const changeEl  = document.getElementById('pmChartChange');
  const legendEl  = document.getElementById('pmVendorLegend');
  const bodyEl    = document.getElementById('pmDetailBody');
  const placeholderEl = document.getElementById('pmChartPlaceholder');

  titleEl.innerHTML = `<a href="/products.html#${esc(product.product_id)}" style="color:inherit;text-decoration:none" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${esc(product.product_name)}</a>`;

  if (!product.purchases.length) {
    warningEl.classList.remove('hidden');
    warningEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> No purchases in the selected date range.';
    subEl.textContent = '';
    changeEl.textContent = '';
    legendEl.innerHTML = '';
    bodyEl.innerHTML = '<tr><td colspan="4" class="empty-row">No purchases in this range.</td></tr>';
    placeholderEl.classList.remove('hidden');
    if (pmChart) { pmChart.destroy(); pmChart = null; }
    return;
  }

  if (product.purchases.length < 2) {
    warningEl.classList.remove('hidden');
    warningEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Not enough data — this product only has 1 purchase in the selected date range.';
  } else {
    warningEl.classList.add('hidden');
  }

  const unit = product.unit || product.purchases[0].pack_unit || 'unit';
  subEl.textContent = `Last ${product.purchases.length} purchase${product.purchases.length === 1 ? '' : 's'} · unit: ${unit}`;

  const cls = changeClass(product.pct_change);
  changeEl.textContent = product.pct_change === null ? '' : `${formatPct(product.pct_change)}`;
  changeEl.className = `pm-chart-change ${cls === 'up' ? 'up' : cls === 'down' ? 'down' : 'flat'}`;
  changeEl.style.color = cls === 'up' ? '#b91c1c' : cls === 'down' ? '#15803d' : 'var(--text-muted)';

  // Build chronological series (oldest → newest).
  const chrono = [...product.purchases].reverse();
  renderChart(chrono, unit);
  renderLegend(chrono);
  renderDetailTable(product.purchases, unit);
  placeholderEl.classList.add('hidden');
}

function renderChart(chrono, unit) {
  const ctx = document.getElementById('pmChart').getContext('2d');
  if (pmChart) pmChart.destroy();

  const colors = chrono.map(p => vendorColor(p.vendor));

  pmChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chrono.map(p => formatDate(p.date)),
      datasets: [{
        label: `Price per ${unit}`,
        // Plot the price normalized to the stocking unit, so a supplier who
        // bills in a different unit doesn't draw a phantom step in the line.
        // null (unconvertible) leaves a gap rather than a fabricated point.
        data: chrono.map(p => p.cost_per_stock_unit ?? null),
        spanGaps: false,
        borderColor: '#94a3b8',
        backgroundColor: 'rgba(148,163,184,.1)',
        borderWidth: 2,
        tension: 0.25,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointBackgroundColor: colors,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items[0] ? fmtDate(chrono[items[0].dataIndex].date) : '',
            label: (item) => {
              const p = chrono[item.dataIndex];
              const lines = [`Vendor: ${p.vendor || '—'}`];
              if (p.cost_per_stock_unit == null) {
                lines.push(`Invoiced: ${fmt(p.cost_per_unit)} / ${p.pack_unit || '?'}`);
                lines.push(`Can't convert to ${unit} — not comparable`);
              } else {
                lines.push(`Price:  ${fmt(p.cost_per_stock_unit)} / ${unit}`);
                // When the supplier billed in another unit, show what they
                // actually invoiced too — otherwise the figure won't match
                // the paperwork.
                if (p.pack_unit && !invSameUnit(p.pack_unit, unit)) {
                  lines.push(`Invoiced as ${fmt(p.cost_per_unit)} / ${p.pack_unit}`);
                }
              }
              return lines;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: false,
          ticks: { callback: (v) => '$' + Number(v).toFixed(2) }
        }
      }
    }
  });
}

function renderLegend(chrono) {
  const vendors = Array.from(new Set(chrono.map(p => (p.vendor || '—').trim() || '—')));
  const html = vendors.map(v =>
    `<span class="pm-vendor-chip"><span class="pm-vendor-dot" style="background:${vendorColor(v)}"></span>${esc(v)}</span>`
  ).join('');
  document.getElementById('pmVendorLegend').innerHTML = html;
}

// Price cell: the figure normalized to the stocking unit (what the chart and
// the % change use), plus what the supplier actually invoiced when that was in
// a different unit — so the row still reconciles with the paperwork.
function _pmPriceCell(p, unit) {
  if (p.cost_per_stock_unit == null) {
    return `<td>${fmt(p.cost_per_unit)} / ${esc(p.pack_unit || '?')}
              <span class="pm-unit-note" title="Can't convert to ${esc(unit)}">not comparable</span></td>`;
  }
  const invoiced = (p.pack_unit && !invSameUnit(p.pack_unit, unit))
    ? `<span class="pm-unit-note">invoiced ${fmt(p.cost_per_unit)}/${esc(p.pack_unit)}</span>`
    : '';
  return `<td>${fmt(p.cost_per_stock_unit)} / ${esc(unit)}${invoiced}</td>`;
}

function renderDetailTable(purchases, unit) {
  const bodyEl = document.getElementById('pmDetailBody');
  bodyEl.innerHTML = purchases.map(p => {
    const cells = `
          <td>${esc(p.vendor || '—')}</td>
          <td>${fmtDate(p.date)}</td>
          <td>${Number(p.pack_qty || 0)} ${esc(p.pack_unit || unit)}</td>
          ${_pmPriceCell(p, unit)}`;
    if (p.invoice_id) {
      return `
        <tr style="cursor:pointer" onclick="window.location.href='/invoices.html#${esc(p.invoice_id)}'" title="Open invoice">${cells}
        </tr>
      `;
    }
    return `
      <tr>${cells}
      </tr>
    `;
  }).join('');
}

// ── Search + suggestions ─────────────────────────────────────
function renderSuggestions() {
  const q = document.getElementById('pmSearch').value.trim().toLowerCase();
  const box = document.getElementById('pmSuggestions');
  if (!q) { box.classList.add('hidden'); box.innerHTML = ''; return; }

  const matches = pmData
    .filter(p => p.product_name.toLowerCase().includes(q))
    .slice(0, 12);

  if (!matches.length) {
    box.classList.remove('hidden');
    box.innerHTML = '<div class="pm-suggestion" style="color:var(--text-muted);cursor:default">No matches</div>';
    return;
  }

  box.classList.remove('hidden');
  box.innerHTML = matches.map(p => {
    const sub = p.purchase_count < 2
      ? '<span style="color:var(--warning)"><i class="fas fa-exclamation-triangle"></i> Not enough data</span>'
      : `${formatPct(p.pct_change)} change · ${p.purchase_count} purchase${p.purchase_count === 1 ? '' : 's'}`;
    return `
      <div class="pm-suggestion" data-id="${esc(p.product_id)}">
        <div style="font-weight:500">${esc(p.product_name)}</div>
        <div class="sub">${sub}</div>
      </div>
    `;
  }).join('');

  box.querySelectorAll('.pm-suggestion[data-id]').forEach(el => {
    el.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const id = el.getAttribute('data-id');
      const prod = pmData.find(p => p.product_id === id);
      if (prod) {
        pmSelectedId = id;
        document.getElementById('pmSearch').value = prod.product_name;
        box.classList.add('hidden');
        renderList();
        renderDetail(prod);
      }
    });
  });
}

// ── Spending Breakdown ────────────────────────────────────────
function sbPresetRange(preset) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case 'this-month':
      return { from: toISODate(new Date(y, m, 1)),     to: toISODate(today) };
    case 'last-month':
      return { from: toISODate(new Date(y, m - 1, 1)), to: toISODate(new Date(y, m, 0)) };
    case 'this-quarter': {
      const qStart = Math.floor(m / 3) * 3;
      return { from: toISODate(new Date(y, qStart, 1)), to: toISODate(today) };
    }
    case 'ytd':
      return { from: toISODate(new Date(y, 0, 1)),     to: toISODate(today) };
  }
}

function sbSetActivePreset(preset) {
  sbActivePreset = preset;
  document.querySelectorAll('.sb-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === preset);
  });
}

const SB_PALETTE = [
  '#4f46e5', '#059669', '#dc2626', '#d97706', '#0891b2',
  '#7c3aed', '#db2777', '#2563eb', '#65a30d', '#ea580c',
  '#0d9488', '#9333ea', '#be123c', '#78716c'
];

function toDDMMYYYY(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function fmtAmt(n) {
  const num = parseFloat(n) || 0;
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadSpendingBreakdown() {
  const totalEl = document.getElementById('sbTotal');
  const listEl  = document.getElementById('sbList');
  totalEl.innerHTML = '';
  listEl.innerHTML = '<div class="sb-empty"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';

  const from = document.getElementById('sbFrom').value;
  const to   = document.getElementById('sbTo').value;

  try {
    const data = await apiGet(`spending-breakdown?from=${from}&to=${to}`);
    renderSpendingBreakdown(data);
  } catch (e) {
    listEl.innerHTML = `<div class="sb-empty" style="color:var(--danger)">Failed to load: ${esc(e.message || e)}</div>`;
  }
}

function sbNavigate(label) {
  // "Uncategorized" / "Unknown" are synthetic fallback labels, not real
  // categories/vendors — spending from invoice lines (or invoices) that don't
  // resolve to a product/vendor. Navigating to a filter for them lands on an
  // empty list, so explain instead.
  if (label === 'Uncategorized') {
    showToast('These are invoice line items whose product name doesn\'t match any product — nothing to filter to. Rename the product to match, or edit the invoice line.', 'info');
    return;
  }
  if (label === 'Unknown') {
    showToast('These are invoices with no vendor set — nothing to filter to.', 'info');
    return;
  }
  if (sbView === 'vendor') {
    window.location.href = `/invoices.html?vendor=${encodeURIComponent(label)}`;
  } else {
    window.location.href = `/index.html?category=${encodeURIComponent(label)}`;
  }
}

function renderSBChart(labels, amounts, pcts) {
  const colors = labels.map((label, i) =>
    label === 'Other Charges' ? '#94a3b8' : SB_PALETTE[i % SB_PALETTE.length]
  );
  const pieLabels = {
    id: 'sbPieLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.getDatasetMeta(0).data.forEach((arc, i) => {
        if (pcts[i] < 4) return;
        const angle = (arc.startAngle + arc.endAngle) / 2;
        const r = arc.outerRadius * 0.65;
        const x = arc.x + Math.cos(angle) * r;
        const y = arc.y + Math.sin(angle) * r;
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.round(pcts[i])}%`, x, y);
        ctx.restore();
      });
    }
  };
  if (sbChart) sbChart.destroy();
  sbChart = new Chart(document.getElementById('sbChart'), {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data: amounts,
        backgroundColor: colors,
        borderColor: '#fff',
        borderWidth: 2,
        hoverBorderWidth: 3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        if (!elements.length) return;
        const label = labels[elements[0].index];
        if (label !== 'Other Charges') sbNavigate(label);
      },
      onHover: (evt, elements) => {
        const active = elements.length && labels[elements[0].index] !== 'Other Charges';
        evt.native.target.style.cursor = active ? 'pointer' : 'default';
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => labels[items[0].dataIndex],
            label: (item) => {
              const i = item.dataIndex;
              return [`  ${fmtAmt(amounts[i])}  ·  ${pcts[i].toFixed(1)}%`];
            }
          }
        }
      }
    },
    plugins: [pieLabels]
  });
}

function renderSpendingBreakdown(data) {
  sbData = data;
  const totalEl = document.getElementById('sbTotal');
  const listEl  = document.getElementById('sbList');

  const total = data.total ?? 0;
  const count = data.invoice_count ?? 0;
  const drFrom = toDDMMYYYY(data.date_range?.from);
  const drTo   = toDDMMYYYY(data.date_range?.to);
  totalEl.innerHTML =
    `<div class="sb-total-row">Total spent: <span class="sb-total-amount">${fmtAmt(total)}</span>` +
    `<span class="sb-total-sep">·</span>` +
    `<span class="sb-total-count">${count} invoice${count === 1 ? '' : 's'}</span></div>` +
    `<div class="sb-date-range">Showing: ${drFrom} – ${drTo}</div>`;

  const isVendor = sbView === 'vendor';
  const nameKey  = isVendor ? 'vendor' : 'category';
  const fallback = isVendor ? 'Unknown' : 'Uncategorized';
  const items    = (isVendor ? (data.by_vendor || []) : (data.by_category || []))
                     .filter(r => (parseFloat(r.amount) || 0) > 0);

  // Other Charges — category view only
  const ocRaw   = !isVendor ? (data.other_charges_breakdown || null) : null;
  const ocTotal = ocRaw
    ? (parseFloat(ocRaw.taxes) || 0) + (parseFloat(ocRaw.deposits) || 0)
      + (parseFloat(ocRaw.delivery) || 0) + (parseFloat(ocRaw.fuel_surcharge) || 0)
    : 0;
  const ocPct = total > 0 ? Math.round((ocTotal / total) * 1000) / 10 : 0;

  if (!items.length && !ocTotal) {
    listEl.innerHTML = '<div class="sb-empty">No spending data for this period.</div>';
    if (sbChart) { sbChart.destroy(); sbChart = null; }
    return;
  }

  const labels  = items.map(r => r[nameKey] || fallback);
  const amounts = items.map(r => parseFloat(r.amount) || 0);
  const pcts    = items.map(r => parseFloat(r.percentage) || 0);

  if (ocTotal > 0) {
    labels.push('Other Charges');
    amounts.push(ocTotal);
    pcts.push(ocPct);
  }

  listEl.innerHTML = items.map(r =>
    `<div class="sb-row" data-label="${esc(r[nameKey] || fallback)}">` +
      `<span class="sb-cat">${esc(r[nameKey] || fallback)}</span>` +
      `<span class="sb-cat-amount">${fmtAmt(r.amount)}</span>` +
    `</div>`
  ).join('');

  listEl.querySelectorAll('.sb-row').forEach(row =>
    row.addEventListener('click', () => sbNavigate(row.dataset.label))
  );

  if (ocTotal > 0) {
    const ocEl = document.createElement('div');
    ocEl.className = 'sb-row sb-oc-row';
    ocEl.innerHTML =
      `<div class="sb-oc-header">` +
        `<span class="sb-cat">Other Charges <i class="fas fa-chevron-down sb-oc-chevron"></i></span>` +
        `<span class="sb-cat-amount">${fmtAmt(ocTotal)}</span>` +
      `</div>` +
      `<div class="sb-oc-detail">` +
        (parseFloat(ocRaw.taxes)          > 0 ? `<div class="sb-oc-sub"><span>Taxes</span><span class="sb-oc-sub-amount">${fmtAmt(ocRaw.taxes)}</span></div>` : '') +
        (parseFloat(ocRaw.deposits)       > 0 ? `<div class="sb-oc-sub"><span>Deposits</span><span class="sb-oc-sub-amount">${fmtAmt(ocRaw.deposits)}</span></div>` : '') +
        (parseFloat(ocRaw.delivery)       > 0 ? `<div class="sb-oc-sub"><span>Delivery</span><span class="sb-oc-sub-amount">${fmtAmt(ocRaw.delivery)}</span></div>` : '') +
        (parseFloat(ocRaw.fuel_surcharge) > 0 ? `<div class="sb-oc-sub"><span>Fuel Surcharge</span><span class="sb-oc-sub-amount">${fmtAmt(ocRaw.fuel_surcharge)}</span></div>` : '') +
      `</div>`;
    ocEl.addEventListener('click', () => ocEl.classList.toggle('sb-expanded'));
    listEl.appendChild(ocEl);
  }

  renderSBChart(labels, amounts, pcts);
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  const ninetyAgo = new Date(today.getTime() - 90 * 86400000);
  document.getElementById('pmTo').value   = toISODate(today);
  document.getElementById('pmFrom').value = toISODate(ninetyAgo);

  document.getElementById('pmFrom').addEventListener('change', loadMovers);
  document.getElementById('pmTo').addEventListener('change', loadMovers);

  const searchEl = document.getElementById('pmSearch');
  searchEl.addEventListener('input', renderSuggestions);
  searchEl.addEventListener('focus', renderSuggestions);
  searchEl.addEventListener('blur', () => {
    clearTimeout(pmSuggestBlur);
    pmSuggestBlur = setTimeout(() => {
      document.getElementById('pmSuggestions').classList.add('hidden');
    }, 150);
  });

  loadMovers();
  loadPnlTile();

  // Spending Breakdown init
  const sbRange = sbPresetRange('this-month');
  document.getElementById('sbFrom').value = sbRange.from;
  document.getElementById('sbTo').value   = sbRange.to;
  sbSetActivePreset('this-month');

  document.querySelectorAll('.sb-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const range = sbPresetRange(btn.dataset.preset);
      document.getElementById('sbFrom').value = range.from;
      document.getElementById('sbTo').value   = range.to;
      sbSetActivePreset(btn.dataset.preset);
      loadSpendingBreakdown();
    });
  });

  document.getElementById('sbFrom').addEventListener('change', () => sbSetActivePreset(null));
  document.getElementById('sbTo').addEventListener('change',   () => sbSetActivePreset(null));
  document.getElementById('sbApply').addEventListener('click', loadSpendingBreakdown);

  document.querySelectorAll('.sb-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sbView = btn.dataset.view;
      document.querySelectorAll('.sb-view-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.view === sbView)
      );
      if (sbData) renderSpendingBreakdown(sbData);
    });
  });

  loadSpendingBreakdown();
});

// ── P&L summary tile ───────────────────────────────────────────
// Current-month snapshot: Net sales (manual) − Costs (invoices + overheads) = Profit.
// Mirrors the P&L page math; links there for the full statement.
async function loadPnlTile() {
  const statsEl = document.getElementById('pnlTileStats');
  const monthEl = document.getElementById('pnlTileMonth');
  if (!statsEl) return;

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (monthEl) {
    monthEl.textContent = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  try {
    const [costs, salesData, ohData, recData, spData] = await Promise.all([
      apiGet(`pnl?month=${month}`),
      apiGet(`tables/sales_monthly?page=1&limit=500`),
      apiGet(`tables/operating_expenses?page=1&limit=1000`),
      apiGet(`tables/recurring_expenses?page=1&limit=500`),
      apiGet(`tables/spread_expenses?page=1&limit=500`),
    ]);
    // This month's fair share of each multi-month "spread" bill (prorated by days).
    const dayNum = ymd => { const [y, m, d] = String(ymd || '').split('-').map(Number); return (y && m && d) ? Math.floor(Date.UTC(y, m - 1, d) / 86400000) : NaN; };
    const [yy, mm] = month.split('-').map(Number);
    const mStart = Math.floor(Date.UTC(yy, mm - 1, 1) / 86400000);
    const mEnd   = Math.floor(Date.UTC(yy, mm, 1) / 86400000) - 1;
    const spreadTotal = (spData.data || []).reduce((s, r) => {
      const a = dayNum(r.start_date), b = dayNum(r.end_date);
      if (isNaN(a) || isNaN(b) || b < a) return s;
      const overlap = Math.max(0, Math.min(b, mEnd) - Math.max(a, mStart) + 1);
      return s + (parseFloat(r.total_amount) || 0) * overlap / (b - a + 1);
    }, 0);

    const salesRow = (salesData.data || []).find(r => r.period === month);
    const sales    = parseFloat(salesRow?.sales_total) || 0;
    const costTotal = (parseFloat(costs.food_cost) || 0)
      + (parseFloat(costs.beverage_cost) || 0)
      + (parseFloat(costs.supplies_cost) || 0)
      + (parseFloat(costs.invoice_fees) || 0)
      + (costs.expense_invoices || []).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
      + (ohData.data || []).filter(r => r.period === month)
          .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
      + (recData.data || []).filter(r => r.active == null || Number(r.active) === 1)
          .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
      + spreadTotal;
    const profit = sales - costTotal;

    const stat = (label, value, color) =>
      `<span style="display:flex;flex-direction:column">
         <span style="font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em">${label}</span>
         <span style="font-size:1.25rem;font-weight:800;font-family:ui-monospace,monospace;color:${color}">${value}</span>
       </span>`;

    const money = n => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    statsEl.innerHTML =
      stat('Net Sales', sales ? money(sales) : '—', 'var(--text)') +
      stat('Costs', money(costTotal), 'var(--text)') +
      stat('Profit', sales ? money(profit) : '—', profit >= 0 ? '#15803d' : '#b91c1c');
  } catch (e) {
    statsEl.innerHTML = `<span style="color:var(--text-muted);font-size:.85rem">P&amp;L unavailable</span>`;
  }
}
