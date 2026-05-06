/* ===== home.js — Price Movers page ===== */

let pmData = [];           // full products array from /api/price-movers
let pmSelectedId = null;   // currently selected product id
let pmChart = null;        // Chart.js instance
let pmSuggestBlur;         // timer id for suggestion dismissal

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
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
    const latest = p.purchases[0];
    const prev   = p.purchases[1];
    const selected = p.product_id === pmSelectedId ? ' selected' : '';
    const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '▸';
    return `
      <div class="pm-row ${cls}${selected}" data-id="${esc(p.product_id)}">
        <div>
          <div class="pm-name">${esc(p.product_name)}</div>
          <div class="pm-meta">
            ${fmt(latest.cost_per_unit)}/${esc(latest.pack_unit || p.unit || 'unit')}
            <span style="color:var(--text-muted)"> · prev ${fmt(prev.cost_per_unit)}</span>
          </div>
        </div>
        <div class="pm-change ${cls}">${arrow} ${formatPct(p.pct_change)}</div>
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
        data: chrono.map(p => p.cost_per_unit),
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
              return [
                `Vendor: ${p.vendor || '—'}`,
                `Price:  ${fmt(p.cost_per_unit)} / ${p.pack_unit || unit}`
              ];
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

function renderDetailTable(purchases, unit) {
  const bodyEl = document.getElementById('pmDetailBody');
  bodyEl.innerHTML = purchases.map(p => {
    if (p.invoice_id) {
      return `
        <tr style="cursor:pointer" onclick="window.location.href='/invoices.html#${esc(p.invoice_id)}'" title="Open invoice">
          <td>${esc(p.vendor || '—')}</td>
          <td>${fmtDate(p.date)}</td>
          <td>${Number(p.pack_qty || 0)} ${esc(p.pack_unit || unit)}</td>
          <td>${fmt(p.cost_per_unit)} / ${esc(unit)}</td>
        </tr>
      `;
    }
    return `
      <tr>
        <td>${esc(p.vendor || '—')}</td>
        <td>${fmtDate(p.date)}</td>
        <td>${Number(p.pack_qty || 0)} ${esc(p.pack_unit || unit)}</td>
        <td>${fmt(p.cost_per_unit)} / ${esc(unit)}</td>
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
});
