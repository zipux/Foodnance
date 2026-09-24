/* ===== home.js — Price Movers page ===== */

let pmData = [];           // full products array from /api/price-movers
let pmSelectedId = null;   // currently selected product id
let pmTab = 'trend';       // 'trend' | 'vendor' | 'portfolio'
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

// A per-unit PRICE has to be quoted in a unit big enough to hold real money.
// Priced per ml or per g it is a fraction of a cent, so fmt() rounds it to
// "$0.00" ("this is free") or squashes genuinely different products onto the
// same penny — Heineken at $0.005551/ml and Peroni at $0.006763/ml both read
// "$0.01 / ml". utils.js already solves this for recipes and finished products
// via scalePriceUnit(); Price Movers is where the customer actually hit it,
// quoting a wine bought at $23.84/L as "$0.02 / ml".
//
// Done ONCE here, at the data boundary, rather than at each of the eight render
// sites (card, trend chart, its axis and tooltip, vendor chart, vendor strip,
// portfolio table, detail table). Every one of those reads product.unit and the
// fields below, so rescaling the payload leaves all of them correct with no
// further change — and there is no site left that could be forgotten.
//
// Three kinds of number, three different rules:
//   PRICES     ($/unit)  multiply by the factor  — cost_per_stock_unit,
//                        latest_price, cheapest_price
//   QUANTITIES (units)   DIVIDE by it            — qty_stock. 18000 ml bought
//                        is 18 L bought; leaving it alone would print "18000 L".
//   TOTALS     ($)       untouched               — spend, overpay_est are
//                        already money and do not depend on the unit at all.
//
// purchases[].cost_per_unit is deliberately NOT touched: it is the figure the
// supplier invoiced, expressed in their own pack_unit, and is shown beside the
// normalised price so the row reconciles with the paperwork. It is scaled at
// the point of display with fmtUnitCost(), which moves value and label together.
function pmRescaleForDisplay(p) {
  const scaled = scalePriceUnit(1, p.unit || '');
  const per    = scaled.cost;
  if (!(per > 0) || per === 1) return p;   // kg, lb, L, each… nothing to do

  const price = v => (v == null ? v : v * per);
  return {
    ...p,
    unit: scaled.unit,
    cheapest_price: price(p.cheapest_price),
    purchases: (p.purchases || []).map(q => ({
      ...q,
      cost_per_stock_unit: price(q.cost_per_stock_unit),
    })),
    vendors: (p.vendors || []).map(v => ({
      ...v,
      latest_price: price(v.latest_price),
      qty_stock:    v.qty_stock == null ? v.qty_stock : v.qty_stock / per,
    })),
  };
}

// One purchase's price, quoted in the unit it is legitimately expressed in: the
// group's comparison unit when it converted, otherwise the unit the supplier
// actually invoiced. The old code fell back to cost_per_unit but kept the
// group's label, so an unconvertible purchase was printed with someone else's
// unit — a $/case figure labelled "/kg".
function _pmQuote(purchase, groupUnit) {
  if (!purchase) return '—';
  return purchase.cost_per_stock_unit != null
    ? fmtUnitCost(purchase.cost_per_stock_unit, groupUnit || 'unit')
    : fmtUnitCost(purchase.cost_per_unit, purchase.pack_unit || 'unit');
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
    pmData = (r.data || []).map(pmRescaleForDisplay);
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

  // The Portfolio tab reads the whole catalog, not the selected product — keep
  // it in sync when the date range changes.
  if (pmTab === 'portfolio') renderPortfolio();
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
            ${_pmQuote(latest, p.unit)}
            <span style="color:var(--text-muted)"> · prev ${_pmQuote(prev, p.unit)}</span>
          </div>
          ${switchNote}
        </div>
        <div class="pm-change ${isSwitch ? 'switch' : cls}" title="${isSwitch ? 'Difference between two different purchases, not a price change by one vendor' : 'Change since your previous purchase. Vendor Compare measures against your cheapest vendor instead, so the two figures differ.'}">
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
    '<tr><td colspan="5" class="empty-row">Select a product to see its purchase history.</td></tr>';
  document.getElementById('pmChartWrap').classList.remove('hidden');
  const ph = document.getElementById('pmChartPlaceholder');
  ph.querySelector('div').textContent = 'No product selected yet';
  ph.classList.remove('hidden');
  hideVendorExtras();
  if (pmChart) { pmChart.destroy(); pmChart = null; }
}

// Hide the Vendor-Compare-only elements (savings headline + vendor list).
function hideVendorExtras() {
  document.getElementById('pmSavings').classList.add('hidden');
  document.getElementById('pmVendorStrip').innerHTML = '';
}

function renderDetail(product) {
  const warningEl = document.getElementById('pmWarning');
  const titleEl   = document.getElementById('pmChartTitle');
  const subEl     = document.getElementById('pmChartSub');
  const changeEl  = document.getElementById('pmChartChange');
  const legendEl  = document.getElementById('pmVendorLegend');
  const bodyEl    = document.getElementById('pmDetailBody');
  const wrapEl    = document.getElementById('pmChartWrap');
  const placeholderEl = document.getElementById('pmChartPlaceholder');

  titleEl.innerHTML = `<a href="/products.html#${esc(product.product_id)}" style="color:inherit;text-decoration:none" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${esc(product.product_name)}</a>`;

  if (!product.purchases.length) {
    warningEl.classList.remove('hidden');
    warningEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> No purchases in the selected date range.';
    subEl.textContent = '';
    changeEl.textContent = '';
    legendEl.innerHTML = '';
    bodyEl.innerHTML = '<tr><td colspan="5" class="empty-row">No purchases in this range.</td></tr>';
    wrapEl.classList.remove('hidden');
    placeholderEl.classList.remove('hidden');
    hideVendorExtras();
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
  // The big % in the headline is no longer the only one on screen, so neither
  // sits on its own. Trend states both of its baselines in words (first →
  // latest in the range, and the latest invoice vs the one before); Vendor
  // Compare measures each vendor against the cheapest. Same product, same
  // prices, different reference points — without a label that reads as a bug.
  // (A $6 gap on prosciutto is -18% against the dearer earlier price and +22%
  // against the cheaper vendor: the same gap from either end.)
  changeEl.textContent = '';
  changeEl.className = 'pm-chart-change';

  // Build chronological series (oldest → newest).
  const chrono = [...product.purchases].reverse();
  if (pmTab === 'vendor') {
    // Vendor Compare is a list, not a chart: each vendor's bar sits on its own
    // row with the price and gap, so nothing is shown twice.
    if (pmChart) { pmChart.destroy(); pmChart = null; }
    wrapEl.classList.add('hidden');
    legendEl.innerHTML = '';
    renderSavings(product, unit);
    renderVendorCompare(product, unit);
    const nv = product.vendor_count || (product.vendors || []).length;
    subEl.textContent = `${nv} vendor${nv === 1 ? '' : 's'} · latest price per ${unit}`;
  } else {
    wrapEl.classList.remove('hidden');
    hideVendorExtras();
    const colors = pmVendorColors(chrono);
    subEl.innerHTML = trendHeadline(product, chrono, unit);
    const runOn = renderChart(chrono, unit, colors);
    renderLegend(chrono, colors, runOn);
  }
  renderDetailTable(product.purchases, unit);
}

// ── Trend tab ────────────────────────────────────────────────
// Supplier colours are assigned per chart, in order of first appearance. They
// used to be hashed from the name into one shared palette, which put La Grotta
// and Cioffi's on the same red on one chart — two suppliers, one colour. Red and
// green are left out on purpose: they already mean "price up" / "price down".
const PM_VENDOR_COLORS = ['#0369a1', '#d97706', '#7c3aed', '#0d9488', '#db2777', '#475569', '#a16207', '#4f46e5'];
function pmVendorKey(v) { return (v || '—').trim() || '—'; }
function pmVendorColors(chrono) {
  const map = new Map();
  for (const p of chrono) {
    const k = pmVendorKey(p.vendor);
    if (!map.has(k)) map.set(k, PM_VENDOR_COLORS[map.size % PM_VENDOR_COLORS.length]);
  }
  return map;
}

const PM_DAY = 86400000;
const PM_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// A YYYY-MM-DD date as local midnight, in ms. Local on purpose: the chart's
// "Today" and the From/To inputs are the user's own calendar days.
function pmDay(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN;
}
function pmToday() {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
}
// "2 Jul", or "2 Jul 2025" when it isn't this year.
function pmShortDate(s) {
  const ms = typeof s === 'number' ? s : pmDay(s);
  if (isNaN(ms)) return '—';
  const d = new Date(ms);
  const yr = d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${PM_MONTHS[d.getMonth()]}${yr}`;
}
// Whole days since a purchase date (null when the date is unreadable).
function pmDaysAgo(s) {
  const ms = pmDay(s);
  return isNaN(ms) ? null : Math.round((pmToday() - ms) / PM_DAY);
}

// Headline: first → latest price over the range, then the latest invoice
// against the one before it (the Top 10 list's figure, kept so the two agree).
function trendHeadline(product, chrono, unit) {
  const cmp = chrono.filter(p => p.cost_per_stock_unit != null);
  const n = chrono.length;
  const shown = product.purchase_count > n ? ` (latest ${n} of ${product.purchase_count})` : '';
  const skipped = product.uncomparable_count
    ? `<span class="pm-hl-ctx">${product.uncomparable_count} purchase${product.uncomparable_count === 1 ? '' : 's'} can't be converted to ${esc(unit)} and ${product.uncomparable_count === 1 ? "isn't" : "aren't"} drawn.</span>`
    : '';
  if (!cmp.length) {
    return `<span class="pm-hl-ctx">Last ${n} purchase${n === 1 ? '' : 's'}${shown} · none can be compared in one unit</span>${skipped}`;
  }

  const first = cmp[0], last = cmp[cmp.length - 1];
  const a = first.cost_per_stock_unit, b = last.cost_per_stock_unit;
  let big = '';
  if (cmp.length >= 2) {
    const pct = a > 0 ? ((b - a) / a) * 100 : null;
    const cls = changeClass(pct);
    big = `<span class="pm-hl-from">${fmt(a)}</span><span class="pm-hl-arrow">→</span>`
      + `<span class="pm-hl-now">${fmt(b)}<small>/${esc(unit)}</small></span>`
      + (pct === null ? '' : `<span class="pm-hl-pill ${cls}">${formatPct(pct)}</span>`);
  } else {
    big = `<span class="pm-hl-now">${fmt(b)}<small>/${esc(unit)}</small></span>`;
  }

  let latest = '';
  if (product.pct_change !== null && cmp.length >= 2) {
    const prev = cmp[cmp.length - 2];
    const same = changeClass(product.pct_change) === 'flat';
    const what = same
      ? `<b>same price</b> as the one before`
      : `<b>${formatPct(product.pct_change)}</b> vs the one before`;
    const sw = product.change_kind === 'supplier'
      ? `, switched from ${esc(product.change_from)} to ${esc(product.change_to)}`
      : product.change_kind === 'item'
        ? `, different item: ${esc(product.change_from)} → ${esc(product.change_to)}`
        : '';
    latest = `<span class="pm-hl-ctx" title="The change since your previous purchase — the figure in the Top 10 list. Vendor Compare measures against your cheapest vendor instead.">`
      + `Latest invoice ${pmShortDate(last.date)}: ${what} (${pmShortDate(prev.date)})${sw}</span>`;
  }

  return `<span class="pm-hl-big">${big}</span>`
    + `<span class="pm-hl-ctx">Since ${pmShortDate(first.date)} · ${n} purchase${n === 1 ? '' : 's'}${shown}</span>`
    + latest + skipped;
}

// Axis ticks for a time span: weeks, months or quarters, plus the end.
function pmTimeTicks(min, max) {
  const spanDays = (max - min) / PM_DAY;
  const ticks = [];
  if (spanDays <= 45) {
    for (let t = min + 7 * PM_DAY; t < max; t += 7 * PM_DAY) ticks.push(t);
  } else {
    const step = spanDays <= 550 ? 1 : 3;
    const d = new Date(min);
    let m = d.getMonth() + 1;
    if (step === 3) m = Math.ceil(m / 3) * 3;
    for (let t = new Date(d.getFullYear(), m, 1).getTime(); t < max;) {
      ticks.push(t);
      const x = new Date(t);
      t = new Date(x.getFullYear(), x.getMonth() + step, 1).getTime();
    }
  }
  // Keep a clear gap before the end label so the two don't overlap.
  const kept = ticks.filter(t => (max - t) > (max - min) * 0.08);
  kept.push(max);
  return { ticks: kept, spanDays };
}
function pmTickLabel(t, spanDays, end, today) {
  if (t === end && end === today) return 'Today';
  const d = new Date(t);
  if (spanDays > 550) return `${PM_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return `${d.getDate()} ${PM_MONTHS[d.getMonth()]}`;
}
// A round step for the price axis (1, 2, 2.5 or 5 × a power of ten).
function pmNiceStep(rough) {
  if (!(rough > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(rough)));
  const f = rough / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

// A stepped line on real dates. A price doesn't drift between invoices, it
// jumps when a new one lands — the old smooth line on evenly spaced labels drew
// a slope that never happened and made a 3-day gap look like a 3-month one.
// The steps are drawn explicitly (a flat run to the next invoice's date, then
// the jump) rather than with Chart.js `stepped`, so the jump is unambiguously on
// the date the new price arrived. Each run takes its supplier's colour.
// Returns the date the dashed "still in effect" run-on ends at, or null.
function renderChart(chrono, unit, colors) {
  const ctx = document.getElementById('pmChart').getContext('2d');
  const placeholderEl = document.getElementById('pmChartPlaceholder');
  if (pmChart) { pmChart.destroy(); pmChart = null; }

  // Only purchases expressible in the comparison unit can sit on a $/unit axis;
  // the headline says how many were left out, and the table still lists them.
  const pts = chrono
    .filter(p => p.cost_per_stock_unit != null && !isNaN(pmDay(p.date)))
    .map(p => ({ x: pmDay(p.date), y: p.cost_per_stock_unit, v: pmVendorKey(p.vendor), p }));
  if (!pts.length) {
    placeholderEl.querySelector('div').textContent = 'No comparable prices in this range';
    placeholderEl.classList.remove('hidden');
    return null;
  }
  placeholderEl.classList.add('hidden');

  const line = [];
  pts.forEach((q, i) => {
    if (i) line.push({ x: q.x, y: pts[i - 1].y, v: q.v, corner: true });
    line.push({ x: q.x, y: q.y, v: q.v, idx: i });
  });

  const today = pmToday();
  const from  = pmDay(document.getElementById('pmFrom').value);
  const to    = pmDay(document.getElementById('pmTo').value);
  const last  = pts[pts.length - 1];
  const xMin  = isNaN(from) ? pts[0].x : Math.min(from, pts[0].x);
  let end     = isNaN(to) ? today : Math.min(to, today);
  end = Math.max(end, last.x);
  const xMax  = end > xMin ? end : xMin + PM_DAY;
  const runOn = end > last.x ? end : null;
  const { ticks, spanDays } = pmTimeTicks(xMin, xMax);

  const ys = pts.map(q => q.y);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const step = pmNiceStep(((hi - lo) || hi * 0.2 || 1) / 4);
  const yMin = Math.max(0, Math.floor((lo - step * 0.6) / step) * step);
  const yMax = Math.ceil((hi + step * 0.6) / step) * step;

  // Print the price wherever it changes, plus the first and latest.
  const labelIdx = new Set([0, pts.length - 1]);
  pts.forEach((q, i) => { if (i && q.y !== pts[i - 1].y) labelIdx.add(i); });
  const priceLabels = {
    id: 'pmPriceLabels',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea } = chart;
      chart.getDatasetMeta(0).data.forEach((el, j) => {
        const i = line[j].idx;
        if (i === undefined || !labelIdx.has(i)) return;
        const prev = pts[i - 1];
        const above = !prev || pts[i].y >= prev.y;
        const text = fmt(pts[i].y);
        ctx.save();
        ctx.font = "600 11px 'IBM Plex Mono', ui-monospace, monospace";
        ctx.fillStyle = '#171512';
        const w = ctx.measureText(text).width;
        const x = Math.max(chartArea.left + 2, Math.min(el.x - w / 2, chartArea.right - w - 2));
        ctx.fillText(text, x, above ? el.y - 11 : el.y + 19);
        ctx.restore();
      });
    }
  };

  const datasets = [{
    label: `Price per ${unit}`,
    data: line,
    parsing: false,
    tension: 0,
    borderWidth: 2.5,
    borderColor: colors.get(pts[0].v),
    segment: {
      // A flat run is the supplier who set that price; a jump is the one who changed it.
      borderColor: c => colors.get(line[c.p1DataIndex].corner ? line[c.p0DataIndex].v : line[c.p1DataIndex].v)
    },
    pointRadius: line.map(q => q.corner ? 0 : 5),
    pointHoverRadius: line.map(q => q.corner ? 0 : 7),
    pointHitRadius: line.map(q => q.corner ? 0 : 6),
    pointBackgroundColor: line.map(q => colors.get(q.v)),
    pointBorderColor: '#fff',
    pointBorderWidth: 2,
    fill: { target: 'origin' },
    backgroundColor: 'rgba(3,105,161,.06)'
  }];
  if (runOn) {
    datasets.push({
      data: [{ x: last.x, y: last.y }, { x: runOn, y: last.y }],
      parsing: false,
      borderColor: '#b8b2a5',
      borderDash: [5, 4],
      borderWidth: 2,
      pointRadius: 0,
      pointHitRadius: 0,
      fill: false
    });
  }

  pmChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    plugins: [priceLabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 16, right: 8 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.datasetIndex === 0 && line[item.dataIndex].idx !== undefined,
          callbacks: {
            title: (items) => items[0] ? fmtDate(pts[line[items[0].dataIndex].idx].p.date) : '',
            label: (item) => {
              const p = pts[line[item.dataIndex].idx].p;
              const lines = [`Vendor: ${p.vendor || '—'}`];
              lines.push(`Price:  ${fmtUnitCost(p.cost_per_stock_unit, unit)}`);
              // When the supplier billed in another unit, show what they
              // actually invoiced too — otherwise the figure won't match
              // the paperwork.
              if (p.pack_unit && !invSameUnit(p.pack_unit, unit)) {
                lines.push(`Invoiced as ${fmtUnitCost(p.cost_per_unit, p.pack_unit)}`);
              }
              return lines;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          min: xMin,
          max: xMax,
          grid: { color: 'rgba(0,0,0,.05)' },
          afterBuildTicks: (axis) => { axis.ticks = ticks.map(v => ({ value: v })); },
          ticks: { autoSkip: false, maxRotation: 0, callback: (v) => pmTickLabel(v, spanDays, xMax, today) }
        },
        y: {
          min: yMin,
          max: yMax,
          ticks: { stepSize: step, callback: (v) => '$' + Number(v).toFixed(2) },
          grid: { color: 'rgba(0,0,0,.05)' }
        }
      }
    }
  });
  return runOn;
}

function renderLegend(chrono, colors, runOn) {
  const vendors = Array.from(new Set(chrono.map(p => pmVendorKey(p.vendor))));
  let html = vendors.map(v =>
    `<span class="pm-vendor-chip"><span class="pm-vendor-seg" style="background:${colors.get(v)}"></span>${esc(v)}</span>`
  ).join('');
  if (runOn) {
    const label = runOn === pmToday() ? 'Price still in effect today' : `Price still in effect on ${pmShortDate(runOn)}`;
    html += `<span class="pm-vendor-chip"><span class="pm-vendor-seg dash"></span>${label}</span>`;
  }
  document.getElementById('pmVendorLegend').innerHTML = html;
}

// ── Tabs ─────────────────────────────────────────────────────
// Tooltip copy for the info icon beside the tab group — keeps the "?" honest
// about whichever tab is currently active.
const PM_TAB_TIPS = {
  trend:     "Trend shows how this product's price per unit has moved over time — each dot is one purchase, and the line takes the colour of the supplier who charged that price. Use it to spot creeping price rises, one-off spikes, or seasonal swings on the items you buy most.",
  vendor:    "Vendor Compare shows the latest price per unit from each supplier side by side, so you can see who's cheapest right now and roughly how much you'd save by switching.",
  portfolio: "Portfolio ranks every multi-vendor item by how much you could save by moving it to its cheapest supplier — your biggest switching wins, top first."
};

function switchTab(tab) {
  pmTab = tab;
  document.querySelectorAll('.pm-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));

  const help = document.getElementById('pmTabHelp');
  if (help && PM_TAB_TIPS[tab]) help.setAttribute('data-tip', PM_TAB_TIPS[tab]);

  const productView   = document.getElementById('pmProductView');
  const portfolioView = document.getElementById('pmPortfolioView');

  if (tab === 'portfolio') {
    productView.classList.add('hidden');
    portfolioView.classList.remove('hidden');
    renderPortfolio();
    return;
  }

  portfolioView.classList.add('hidden');
  productView.classList.remove('hidden');
  // Re-render the selected product with this tab's chart.
  const prod = pmSelectedId ? pmData.find(p => p.product_id === pmSelectedId) : null;
  if (prod) renderDetail(prod); else clearDetail();
}

// ── Vendor Compare tab ───────────────────────────────────────
// One row per vendor: its bar, latest price/unit and gap to the cheapest on the
// same line. This replaced a bar chart with a table under it that repeated the
// same prices and percentages, in a second colour system. Bars answer the
// actual question ("who's cheapest, and by how much?") and read cleanly even
// with one purchase each — a time series has nothing to connect here.
const PM_STALE_DAYS = 30;

function renderVendorCompare(product, unit) {
  const el = document.getElementById('pmVendorStrip');
  const vendors = product.vendors || [];
  if (!vendors.length) { el.innerHTML = ''; return; }

  // Backend sorts vendors ascending by latest_price, so the first priced one is
  // the cheapest. Vendors whose unit can't be reconciled have no comparable
  // price; they are listed without a bar.
  const priced   = vendors.filter(v => v.latest_price != null);
  const cheapest = product.cheapest_price;
  const maxPrice = priced.length ? Math.max(...priced.map(v => v.latest_price)) : 0;
  const step     = pmNiceStep(maxPrice / 3);
  const scaleMax = maxPrice > 0 ? Math.ceil(maxPrice / step) * step : 1;
  const tickVals = [];
  for (let t = 0; t <= scaleMax + step / 2; t += step) tickVals.push(t);

  // Faint grid lines behind the bars at each tick, so they line up with the scale.
  const inner = tickVals.slice(1, -1).map(t => (t / scaleMax) * 100);
  const gridBg = inner.length
    ? 'background:linear-gradient(90deg,' + inner.map(x =>
        `transparent calc(${x.toFixed(2)}% - 1px),#efece6 calc(${x.toFixed(2)}% - 1px) ${x.toFixed(2)}%,transparent ${x.toFixed(2)}%`
      ).join(',') + ')'
    : '';

  // "Most bought" ties the rows to the savings headline ("move your volume").
  const totalQty = vendors.reduce((s, v) => s + (v.qty_stock > 0 ? v.qty_stock : 0), 0);
  const most = vendors.length >= 2 && totalQty > 0
    ? vendors.reduce((a, b) => ((b.qty_stock || 0) > (a.qty_stock || 0) ? b : a))
    : null;

  let anyStale = false;
  const rows = vendors.map(v => {
    const isCheapest = product.cheapest_vendor && v.name === product.cheapest_vendor && v.latest_price != null;
    // Stale: last bought from this vendor more than 30 days ago, so the "latest
    // price" comparison isn't over-trusted.
    const days  = v.latest_date ? pmDaysAgo(v.latest_date) : null;
    const stale = days != null && days > PM_STALE_DAYS;
    if (stale && v.latest_price != null) anyStale = true;

    let badge;
    if (v.latest_price == null) {
      badge = `<span class="pm-vbadge" title="This vendor's unit can't be converted to ${esc(unit)}">n/a</span>`;
    } else if (isCheapest) {
      badge = `<span class="pm-vbadge base">cheapest</span>`;
    } else if (cheapest != null && cheapest > 0) {
      const pct = Math.round(((v.latest_price - cheapest) / cheapest) * 100);
      badge = `<span class="pm-vbadge up" title="How much more than your cheapest vendor">+${pct}%</span>`;
    } else {
      badge = `<span class="pm-vbadge">—</span>`;
    }

    const share = vendors.length >= 2 && totalQty > 0 && v.qty_stock > 0
      ? ` · ${Math.round((v.qty_stock / totalQty) * 100)}% of your volume` : '';
    const meta = `${Math.round(v.qty_stock)} ${esc(unit)} bought for ${fmt(v.spend)}${share}`
      + (stale ? `<span class="old">Last bought ${days} days ago</span>` : '');
    const bar = v.latest_price != null
      ? `<div class="pm-vc-bar${stale ? ' stale' : ''}" style="width:${Math.min(100, (v.latest_price / scaleMax) * 100).toFixed(2)}%"></div>`
      : '';
    const price = v.latest_price != null
      ? `${fmt(v.latest_price)}<small>/${esc(unit)}</small>`
      : '—';

    return `
      <div class="pm-vc-row${isCheapest ? ' cheapest' : ''}">
        <div class="pm-vc-who">
          <div class="pm-vc-name"><span class="pm-vc-name-txt">${esc(v.name)}</span>${most === v ? '<span class="pm-chip">Most bought</span>' : ''}</div>
          <div class="pm-vc-meta">${meta}</div>
        </div>
        <div class="pm-vc-track" style="${gridBg}">${bar}</div>
        <div class="pm-vc-price"><span class="v">${price}</span>${badge}</div>
      </div>`;
  }).join('');

  const scale = `
    <div class="pm-vc-scale" aria-hidden="true"><span></span>
      <div class="pm-vc-ticks">${tickVals.map(t =>
        `<span style="left:${((t / scaleMax) * 100).toFixed(2)}%">${t === 0 ? '$0' : fmt(t).replace(/\.00$/, '')}</span>`
      ).join('')}</div><span></span>
    </div>`;
  const key = `
    <div class="pm-key">
      <span><i class="k-cheap"></i>Cheapest</span>
      <span><i class="k-other"></i>Other vendors</span>
      ${anyStale ? '<span><i class="k-stale"></i>Price over 30 days old</span>' : ''}
    </div>`;

  el.innerHTML = `<div class="pm-vc-list">${priced.length ? scale : ''}${rows}</div>${priced.length ? key : ''}`;
}

// Headline: the dollar figure a manager acts on — with a warning when the
// saving rests on prices nobody has paid for a month or more.
function renderSavings(product, unit) {
  const el = document.getElementById('pmSavings');
  const save = Number(product.overpay_est || 0);
  const nVendors = product.vendor_count || (product.vendors ? product.vendors.length : 0);

  el.classList.remove('hidden');
  if (nVendors < 2) {
    el.className = 'pm-savings flat';
    el.innerHTML = `<i class="fas fa-circle-info"></i> <span>Only one vendor supplied this in range — nothing to compare yet.</span>`;
  } else if (save < 1) {
    el.className = 'pm-savings flat';
    el.innerHTML = `<i class="fas fa-circle-check"></i> <span>You're already buying at the cheapest available price.</span>`;
  } else {
    const priced = (product.vendors || []).filter(v => v.latest_price != null);
    const ages = priced.map(v => (v.latest_date ? pmDaysAgo(v.latest_date) : null));
    const allStale = priced.length > 0 && ages.every(d => d != null && d > PM_STALE_DAYS);
    const cheap = priced.find(v => v.name === product.cheapest_vendor);
    const cheapAge = cheap && cheap.latest_date ? pmDaysAgo(cheap.latest_date) : null;
    let caveat = '';
    if (allStale) {
      caveat = `${priced.length === 2 ? 'Both' : 'All'} prices are over 30 days old. Check with the supplier before switching.`;
    } else if (cheapAge != null && cheapAge > PM_STALE_DAYS) {
      caveat = `The price from ${esc(product.cheapest_vendor)} is ${cheapAge} days old. Check with the supplier before switching.`;
    }
    el.className = 'pm-savings';
    el.innerHTML = `<i class="fas fa-piggy-bank"></i> <span>Est. save <span class="amt">${fmt(save)}</span> by moving your volume to <strong>${esc(product.cheapest_vendor)}</strong> at current prices.`
      + (caveat ? `<span class="pm-savings-caveat">${caveat}</span>` : '') + `</span>`;
  }
}

// ── Portfolio tab ────────────────────────────────────────────
// Catalog-wide scan: where am I not on the cheapest vendor, ranked by $ impact.
// Each row's bar is its saving against the biggest one; the strip on top splits
// the total so it's obvious where to start.
function renderPortfolio() {
  const el = document.getElementById('pmPortfolioBody');
  const rows = pmData
    .filter(p => Number(p.overpay_est || 0) >= 1 && (p.vendor_count || 0) >= 2)
    .sort((a, b) => Number(b.overpay_est) - Number(a.overpay_est));

  if (!rows.length) {
    el.innerHTML = `<div class="pm-portfolio-empty"><i class="fas fa-circle-check"></i>Nothing to switch in this range — every multi-vendor item is already on (or within ~$1 of) its cheapest supplier.</div>`;
    return;
  }

  const total = rows.reduce((s, p) => s + Number(p.overpay_est), 0);
  const maxSave = Number(rows[0].overpay_est);
  const n = rows.length;
  const from = document.getElementById('pmFrom').value;
  const to   = document.getElementById('pmTo').value;
  const period = from && to ? `Based on your purchases from ${pmShortDate(from)} to ${pmShortDate(to)}.` : '';
  const top2 = n >= 3 ? Number(rows[0].overpay_est) + Number(rows[1].overpay_est) : 0;
  const top2Line = n >= 3 ? ` Your top 2 items are ${Math.round((top2 / total) * 100)}% of it.` : '';

  const staleOf = p => {
    const c = (p.vendors || []).find(v => v.name === p.cheapest_vendor && v.latest_price != null);
    const d = c && c.latest_date ? pmDaysAgo(c.latest_date) : null;
    return d != null && d > PM_STALE_DAYS ? d : null;
  };
  const staleCount = rows.filter(p => staleOf(p) != null).length;
  const caveat = staleCount
    ? `<span class="pm-savings-caveat">${staleCount === 1 ? '1 of these savings rests on a price' : `${staleCount} of these savings rest on prices`} over 30 days old.</span>`
    : '';

  const strip = n >= 3 ? `
    <div class="pm-share" aria-label="Share of total savings by item">
      <div class="pm-share-bar">${rows.map(p =>
        `<span style="flex:${Number(p.overpay_est).toFixed(2)} 1 0" title="${esc(p.product_name)} · ${fmt(p.overpay_est)}"></span>`
      ).join('')}</div>
      <div class="pm-share-cap">
        <span><b>${esc(rows[0].product_name)} + ${esc(rows[1].product_name)}</b> · ${fmt(top2)}</span>
        <span>${n - 2 === 1 ? '1 other item' : `Other ${n - 2} items`} · ${fmt(total - top2)}</span>
      </div>
    </div>` : '';

  const list = rows.map((p, i) => {
    const unit = p.unit || 'unit';
    const cheap = p.cheapest_price;
    // The pricier vendor that accounts for most of this item's saving.
    const dearer = (p.vendors || [])
      .filter(v => v.latest_price != null && v.name !== p.cheapest_vendor && v.latest_price > (cheap || 0))
      .map(v => ({ v, part: (v.qty_stock || 0) * (v.latest_price - (cheap || 0)) }))
      .sort((a, b) => b.part - a.part);
    const main = dearer.length ? dearer[0].v : null;
    const more = dearer.length > 1 ? ` · +${dearer.length - 1} more supplier${dearer.length > 2 ? 's' : ''}` : '';
    const pct = main && cheap > 0 ? Math.round(((main.latest_price - cheap) / cheap) * 100) : null;
    const swap = main
      ? `<span class="from">${esc(main.name)} ${fmt(main.latest_price)}</span> → <span class="to">${esc(p.cheapest_vendor)} ${fmt(cheap)}/${esc(unit)}</span>`
        + (pct !== null ? ` · +${pct}%` : '')
        + ` · ${Math.round(main.qty_stock)} ${esc(unit)} from ${esc(main.name)}${more}`
      : `<span class="to">${esc(p.cheapest_vendor)} ${fmt(cheap)}/${esc(unit)}</span>`;
    const age = staleOf(p);
    const save = Number(p.overpay_est);
    return `
      <div class="pm-pf-row" role="listitem" tabindex="0" data-id="${esc(p.product_id)}" title="Open in Vendor Compare">
        <span class="pm-pf-rank">${i + 1}</span>
        <div class="pm-pf-what">
          <div class="pm-pf-name">${esc(p.product_name)}</div>
          <div class="pm-pf-swap">${swap}</div>
          ${age != null ? `<span class="pm-pf-old">Price from ${esc(p.cheapest_vendor)} is ${age} days old</span>` : ''}
        </div>
        <div class="pm-pf-barcell">
          <div class="pm-pf-track"><div class="pm-pf-bar${age != null ? ' stale' : ''}" style="width:${((save / maxSave) * 100).toFixed(2)}%"></div></div>
          <span class="pm-pf-pct">${Math.round((save / total) * 100)}% of total</span>
        </div>
        <div class="pm-pf-amt">${fmt(save)}</div>
        <i class="fas fa-chevron-right pm-pf-chev" aria-hidden="true"></i>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="pm-savings"><i class="fas fa-piggy-bank"></i> <span>Est. save <span class="amt">${fmt(total)}</span> by switching ${n} item${n === 1 ? '' : 's'} to their cheapest supplier.`
      + (period || top2Line ? `<span class="pm-savings-sub">${period}${top2Line}</span>` : '')
      + caveat + `</span></div>
    ${strip}
    <div class="pm-pf-list" role="list">${list}</div>
    <div class="pm-key">
      <span><i class="k-cheap"></i>Saving on a recent price</span>
      ${staleCount ? '<span><i class="k-stale-cheap"></i>Cheapest price over 30 days old</span>' : ''}
    </div>`;

  const open = (id) => {
    const prod = pmData.find(p => p.product_id === id);
    if (prod) {
      pmSelectedId = id;
      renderList();
      switchTab('vendor');
    }
  };
  el.querySelectorAll('.pm-pf-row[data-id]').forEach(row => {
    row.addEventListener('click', () => open(row.getAttribute('data-id')));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(row.getAttribute('data-id')); }
    });
  });
}

// Price cell: the figure normalized to the stocking unit (what the chart and
// the % change use), plus what the supplier actually invoiced when that was in
// a different unit — so the row still reconciles with the paperwork.
function _pmPriceCell(p, unit) {
  if (p.cost_per_stock_unit == null) {
    return `<td>${esc(fmtUnitCost(p.cost_per_unit, p.pack_unit || 'unit'))}
              <span class="pm-unit-note" title="Can't convert to ${esc(unit)}">not comparable</span></td>`;
  }
  const invoiced = (p.pack_unit && !invSameUnit(p.pack_unit, unit))
    ? `<span class="pm-unit-note">invoiced ${esc(fmtUnitCost(p.cost_per_unit, p.pack_unit))}</span>`
    : '';
  return `<td>${esc(fmtUnitCost(p.cost_per_stock_unit, unit))}${invoiced}</td>`;
}

function renderDetailTable(purchases, unit) {
  const bodyEl = document.getElementById('pmDetailBody');
  bodyEl.innerHTML = purchases.map(p => {
    const item = (p.vendor_item || '').trim();
    const cells = `
          <td>${esc(p.vendor || '—')}</td>
          <td>${item ? esc(item) : '<span style="color:var(--text-muted)">—</span>'}</td>
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
  '#0369a1', '#059669', '#dc2626', '#d97706', '#0891b2',
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
    window.location.href = `/products.html?category=${encodeURIComponent(label)}`;
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

  document.querySelectorAll('.pm-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

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
    const [costs, salesData, ohData, recData, spData, labData] = await Promise.all([
      apiGet(`pnl?month=${month}`),
      apiGet(`tables/sales_monthly?page=1&limit=500`),
      apiGet(`tables/operating_expenses?page=1&limit=1000`),
      apiGet(`tables/recurring_expenses?page=1&limit=500`),
      apiGet(`tables/spread_expenses?page=1&limit=500`),
      apiGet(`tables/labor_periods?page=1&limit=500`),
    ]);
    // This month's fair share of each multi-month "spread" bill (prorated by days).
    const dayNum = ymd => { const [y, m, d] = String(ymd || '').split('-').map(Number); return (y && m && d) ? Math.floor(Date.UTC(y, m - 1, d) / 86400000) : NaN; };
    const [yy, mm] = month.split('-').map(Number);
    const mStart = Math.floor(Date.UTC(yy, mm - 1, 1) / 86400000);
    const mEnd   = Math.floor(Date.UTC(yy, mm, 1) / 86400000) - 1;
    const monthShare = rows => (rows || []).reduce((s, r) => {
      const a = dayNum(r.start_date), b = dayNum(r.end_date);
      if (isNaN(a) || isNaN(b) || b < a) return s;
      const overlap = Math.max(0, Math.min(b, mEnd) - Math.max(a, mStart) + 1);
      return s + (parseFloat(r.total_amount) || 0) * overlap / (b - a + 1);
    }, 0);
    const spreadTotal = monthShare(spData.data);
    // Labour is prorated by days the same way (labor_periods, same columns), and
    // it has to be here: this tile and the P&L page show the same month's
    // profit, so a cost counted in one and not the other reads as a bug in
    // whichever screen the user checked second.
    const laborTotal = monthShare(labData.data);

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
      + spreadTotal
      + laborTotal;
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
