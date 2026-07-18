/* ===== stock-take.js ===== */

let stockTake = null;        // the active stock_takes row
let snapshotItems = [];      // stock_take_items rows (snapshot of inventory at start)
// In-memory state per snapshot id: { counted: string, reason: string }
const inputState = new Map();
// Debounce timers for autosave per snapshot id
const saveTimers = new Map();

// Pack-size config per raw_material product id (only products that use pack
// levels): { base_unit, mid_name, mid_lb, top_name, top_lb }. Lets a product be
// counted by case / bag / loose weight, all summed to one base-weight figure.
const packByProductId = new Map();
// Per-snapshot box entries for pack items: { top: string, mid: string, base: string }
const packBoxState = new Map();

// Weight conversion (base is always a weight; convert the summed base total into
// the inventory row's own unit so the stored count stays in that unit).
const _WT_FACTOR = { lb: 0.45359237, lbs: 0.45359237, kg: 1, g: 0.001, oz: 0.0283495231 };
function _wtFactor(u) { return _WT_FACTOR[String(u || '').trim().toLowerCase()]; }
function _sameUnit(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
// Returns converted qty, or null if the units aren't both convertible weights.
function convWeight(qty, from, to) {
  if (_sameUnit(from, to)) return qty;
  const f = _wtFactor(from), t = _wtFactor(to);
  if (f && t) return qty * (f / t);
  return null;
}

// Pack config for a snapshot row, but only when it can be safely reconciled to
// the row's stored unit (same unit, or both convertible weights). Otherwise the
// row falls back to the plain single-count input.
function packInfoFor(it) {
  if (it.item_type !== 'raw_material') return null;
  const p = packByProductId.get(it.item_id);
  if (!p) return null;
  const base = p.base_unit || 'lb';
  if (!_sameUnit(base, it.unit) && convWeight(1, base, it.unit) === null) return null;
  return { ...p, base_unit: base };
}

const TYPE_META = {
  raw_material:     { label: 'Raw Materials',     icon: 'fa-seedling' },
  batch:            { label: 'Batches',           icon: 'fa-blender' },
  finished_product: { label: 'Finished Products', icon: 'fa-box-open' },
};
const TYPE_ORDER = ['raw_material', 'batch', 'finished_product'];

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('stDate').textContent = todayYMD();
  document.getElementById('stCancelBtn').addEventListener('click', cancelStockTake);
  document.getElementById('stSubmitBtn').addEventListener('click', submitStockTake);
  await loadOrStart();
});

function round6(n) { return Math.round(n * 1e6) / 1e6; }

// Fetch generic products and record pack-size config for those that use it.
async function loadPackConfig() {
  try {
    const res = await fetch('/api/tables/generic_products?page=1&limit=1000');
    if (!res.ok) return;
    const data = await res.json();
    for (const g of (data.data || [])) {
      const midLb = g.mid_lb != null ? Number(g.mid_lb) : null;
      const topLb = g.top_lb != null ? Number(g.top_lb) : null;
      const hasMid = midLb != null && midLb > 0;
      const hasTop = topLb != null && topLb > 0;
      if (!hasMid && !hasTop) continue;   // no pack levels → count as today
      packByProductId.set(g.id, {
        base_unit: g.base_unit || 'lb',
        mid_name: g.mid_name || 'bag', mid_lb: hasMid ? midLb : null,
        top_name: g.top_name || 'case', top_lb: hasTop ? topLb : null,
      });
    }
  } catch (_) {
    // Non-fatal — pack items just fall back to single-count entry.
  }
}

function todayYMD() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}/${mm}/${dd}`;
}

async function loadOrStart() {
  try {
    // POST /start is idempotent — returns existing in-progress take or creates one
    const res = await fetch('/api/stock-take/start', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
    if (!res.ok) throw new Error(`Start failed: ${res.status}`);
    const data = await res.json();

    stockTake = data.stock_take;
    snapshotItems = data.items || [];

    // Load pack-size config for products that use multi-level counting.
    await loadPackConfig();

    // Seed inputState from any previously-entered values on resume
    for (const it of snapshotItems) {
      const hasCount = it.counted_qty !== null && it.counted_qty !== undefined;
      inputState.set(it.id, {
        counted: hasCount ? String(it.counted_qty) : '',
        reason:  it.reason || '',
      });
      // For pack items on resume, put the whole saved amount in the loose box
      // (converted back to the base unit) so the boxes re-sum to the same total.
      const pack = packInfoFor(it);
      if (pack) {
        let baseLoose = '';
        if (hasCount) {
          const conv = convWeight(Number(it.counted_qty), it.unit, pack.base_unit);
          baseLoose = conv === null ? String(it.counted_qty) : String(round6(conv));
        }
        packBoxState.set(it.id, { top: '', mid: '', base: baseLoose });
      }
    }

    if (data.resumed) {
      showToast('Resumed your in-progress stock take.', 'warning');
    }

    document.getElementById('stLoading').style.display = 'none';
    document.getElementById('stBody').style.display = '';
    document.getElementById('stFooter').style.display = '';
    render();
  } catch (e) {
    document.getElementById('stLoading').innerHTML =
      `<i class="fas fa-exclamation-triangle"></i> Failed to load stock take: ${esc(e.message)}`;
  }
}

function render() {
  const body = document.getElementById('stBody');

  if (!snapshotItems.length) {
    body.innerHTML = `<div class="st-loading"><i class="fas fa-box-open"></i> No inventory items to count.</div>`;
    updateProgress();
    return;
  }

  // Group by item_type
  const groups = {};
  for (const it of snapshotItems) {
    (groups[it.item_type] = groups[it.item_type] || []).push(it);
  }

  let html = '';
  for (const type of TYPE_ORDER) {
    const items = groups[type];
    if (!items || !items.length) continue;
    items.sort((a, b) => (a.item_name || '').localeCompare(b.item_name || ''));

    const meta = TYPE_META[type] || { label: type, icon: 'fa-box' };
    const countedInGroup = items.filter(it => hasCount(it.id)).length;

    html += `
      <section class="st-group" data-type="${esc(type)}">
        <div class="st-group-header">
          <i class="fas ${meta.icon}"></i> ${esc(meta.label)}
          <span class="st-group-count">${countedInGroup} / ${items.length} counted</span>
        </div>
        ${renderTable(items)}
        ${renderCards(items)}
      </section>
    `;
  }

  body.innerHTML = html;
  attachInputListeners();
  updateProgress();
}

function hasCount(snapId) {
  const s = inputState.get(snapId);
  if (!s) return false;
  const v = (s.counted || '').trim();
  return v !== '' && !isNaN(parseFloat(v));
}

function renderTable(items) {
  return `
    <table class="st-table">
      <thead>
        <tr>
          <th>Item</th>
          <th>Expected</th>
          <th>Counted</th>
          <th>Variance</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(rowHtml).join('')}
      </tbody>
    </table>
  `;
}

function rowHtml(it) {
  const state = inputState.get(it.id) || { counted: '', reason: '' };
  const counted = state.counted;
  const reason  = state.reason;
  const hasC    = hasCount(it.id);
  const variance = hasC ? (parseFloat(counted) - (parseFloat(it.expected_qty) || 0)) : null;
  const rowCls = hasC
    ? (variance !== 0 ? 'has-variance' : 'has-count')
    : '';
  const pack = packInfoFor(it);
  const countedCell = pack
    ? packInputsHtml(it, pack)
    : `<input type="number" step="any" class="st-input st-count-input"
               data-snap-id="${esc(it.id)}"
               value="${esc(counted)}"
               placeholder="0" />`;
  return `
    <tr class="${rowCls}" data-snap-id="${esc(it.id)}">
      <td>
        <div class="st-name">${esc(it.item_name)}</div>
        ${it.category ? `<div class="st-cat">${esc(it.category)}</div>` : ''}
      </td>
      <td><span class="st-expected">${fmtQty(it.expected_qty)}<span class="unit">${esc(it.unit || '')}</span></span></td>
      <td>${countedCell}</td>
      <td>${varianceHtml(variance, it.unit)}</td>
      <td>${reasonHtml(it.id, reason, hasC && variance !== 0)}</td>
    </tr>
  `;
}

// Multi-box entry for a pack item: one box per active level (top → mid → base),
// with a live total shown in the row's stored unit.
function packInputsHtml(it, pack) {
  const bs = packBoxState.get(it.id) || { top: '', mid: '', base: '' };
  const boxes = [];
  if (pack.top_lb != null) boxes.push(packBox(it.id, 'top',  pack.top_name, bs.top, `${fmtQty(pack.top_lb)} ${pack.base_unit}`));
  if (pack.mid_lb != null) boxes.push(packBox(it.id, 'mid',  pack.mid_name, bs.mid, `${fmtQty(pack.mid_lb)} ${pack.base_unit}`));
  boxes.push(packBox(it.id, 'base', `loose ${pack.base_unit}`, bs.base, ''));
  const total = packTotalCounted(it, pack);
  return `
    <div class="st-pack">
      ${boxes.join('')}
      <div class="st-pack-total">= <strong data-pack-total="${esc(it.id)}">${total === null ? '0' : fmtQty(total)}</strong> ${esc(it.unit || pack.base_unit)}</div>
    </div>`;
}

function packBox(snapId, level, label, val, hint) {
  return `
    <label class="st-pack-box">
      <input type="number" step="any" class="st-input st-pack-input"
             data-snap-id="${esc(snapId)}" data-level="${esc(level)}"
             value="${esc(val)}" placeholder="0" />
      <span class="st-pack-lbl">${esc(label)}${hint ? `<span class="st-pack-hint"> · ${esc(hint)} ea</span>` : ''}</span>
    </label>`;
}

// Total in the base weight unit (top·top_lb + mid·mid_lb + loose base).
function packTotalBase(it, pack) {
  const bs = packBoxState.get(it.id) || { top: '', mid: '', base: '' };
  let total = parseFloat(bs.base) || 0;
  if (pack.top_lb != null) total += (parseFloat(bs.top) || 0) * pack.top_lb;
  if (pack.mid_lb != null) total += (parseFloat(bs.mid) || 0) * pack.mid_lb;
  return total;
}

function packAnyEntered(snapId) {
  const bs = packBoxState.get(snapId) || { top: '', mid: '', base: '' };
  return ['top', 'mid', 'base'].some(k => (bs[k] || '').trim() !== '' && !isNaN(parseFloat(bs[k])));
}

// Total converted into the row's stored unit (what gets saved as counted_qty).
// null when nothing has been entered yet (= not counted).
function packTotalCounted(it, pack) {
  if (!packAnyEntered(it.id)) return null;
  const base = packTotalBase(it, pack);
  const conv = convWeight(base, pack.base_unit, it.unit);
  return round6(conv === null ? base : conv);
}

function renderCards(items) {
  return `
    <div class="st-cards">
      ${items.map(cardHtml).join('')}
    </div>
  `;
}

function cardHtml(it) {
  const state = inputState.get(it.id) || { counted: '', reason: '' };
  const counted = state.counted;
  const reason  = state.reason;
  const hasC    = hasCount(it.id);
  const variance = hasC ? (parseFloat(counted) - (parseFloat(it.expected_qty) || 0)) : null;
  const cardCls = hasC
    ? (variance !== 0 ? 'has-variance' : 'has-count')
    : '';
  const pack = packInfoFor(it);
  const countedInput = pack
    ? packInputsHtml(it, pack)
    : `<input type="number" step="any" class="st-input st-count-input"
                 data-snap-id="${esc(it.id)}"
                 value="${esc(counted)}"
                 placeholder="0" />`;
  return `
    <div class="st-card ${cardCls}" data-snap-id="${esc(it.id)}">
      <div class="st-card-head">
        <div>
          <div class="st-card-name">${esc(it.item_name)}</div>
          ${it.category ? `<div class="st-card-cat">${esc(it.category)}</div>` : ''}
        </div>
        <div class="st-card-expected">
          Expected <strong>${fmtQty(it.expected_qty)} ${esc(it.unit || '')}</strong>
        </div>
      </div>
      <div class="st-card-row">
        <div>
          <label>Counted</label>
          ${countedInput}
        </div>
        <div>
          <label>Reason</label>
          ${reasonHtml(it.id, reason, hasC && variance !== 0)}
        </div>
      </div>
      <div class="st-card-variance-row">
        <span class="st-card-cat">Variance</span>
        ${varianceHtml(variance, it.unit)}
      </div>
    </div>
  `;
}

function varianceHtml(variance, unit) {
  if (variance === null) {
    return `<span class="st-variance"><span class="placeholder">—</span></span>`;
  }
  if (variance === 0) {
    return `<span class="st-variance zero">0 ${esc(unit || '')}</span>`;
  }
  const sign = variance > 0 ? '+' : '−';
  const abs  = Math.abs(variance);
  const cls  = variance > 0 ? 'pos' : 'neg';
  return `<span class="st-variance ${cls}">${sign}${fmtQty(abs)} ${esc(unit || '')}</span>`;
}

function reasonHtml(snapId, currentReason, visible) {
  const cls = visible ? 'st-reason' : 'st-reason hidden-slot';
  return `
    <select class="${cls} st-reason-select" data-snap-id="${esc(snapId)}" ${visible ? '' : 'tabindex="-1"'}>
      <option value="">Select reason…</option>
      <option value="Kitchen usage" ${currentReason === 'Kitchen usage' ? 'selected' : ''}>Kitchen usage</option>
      <option value="Other"         ${currentReason === 'Other'         ? 'selected' : ''}>Other</option>
    </select>
  `;
}

function fmtQty(n) {
  const num = parseFloat(n);
  if (isNaN(num)) return '0';
  return num % 1 === 0 ? String(num) : num.toFixed(3).replace(/\.?0+$/, '');
}

function attachInputListeners() {
  document.querySelectorAll('.st-count-input').forEach(el => {
    el.addEventListener('input', onCountChange);
  });
  document.querySelectorAll('.st-pack-input').forEach(el => {
    el.addEventListener('input', onPackBoxChange);
  });
  document.querySelectorAll('.st-reason-select').forEach(el => {
    el.addEventListener('change', onReasonChange);
  });
}

// A pack box changed: recompute the row's total (in the stored unit), push it
// into inputState.counted so variance/progress/autosave all keep working, and
// refresh the live total shown next to the boxes.
function onPackBoxChange(e) {
  const snapId = e.target.dataset.snapId;
  const level  = e.target.dataset.level;
  const bs = packBoxState.get(snapId) || { top: '', mid: '', base: '' };
  bs[level] = e.target.value;
  packBoxState.set(snapId, bs);

  const it   = snapshotItems.find(s => s.id === snapId);
  const pack = it ? packInfoFor(it) : null;
  const total = pack ? packTotalCounted(it, pack) : null;

  const state = inputState.get(snapId) || { counted: '', reason: '' };
  state.counted = total === null ? '' : String(total);
  inputState.set(snapId, state);

  document.querySelectorAll(`[data-pack-total="${cssEscape(snapId)}"]`).forEach(el => {
    el.textContent = total === null ? '0' : fmtQty(total);
  });

  updateRow(snapId);
  scheduleAutosave(snapId);
}

function onCountChange(e) {
  const snapId = e.target.dataset.snapId;
  const state  = inputState.get(snapId) || { counted: '', reason: '' };
  state.counted = e.target.value;
  inputState.set(snapId, state);
  updateRow(snapId);
  scheduleAutosave(snapId);
}

function onReasonChange(e) {
  const snapId = e.target.dataset.snapId;
  const state  = inputState.get(snapId) || { counted: '', reason: '' };
  state.reason = e.target.value;
  inputState.set(snapId, state);
  scheduleAutosave(snapId);
}

function scheduleAutosave(snapId) {
  if (saveTimers.has(snapId)) clearTimeout(saveTimers.get(snapId));
  saveTimers.set(snapId, setTimeout(() => {
    saveTimers.delete(snapId);
    autosaveItem(snapId);
  }, 600));
}

async function autosaveItem(snapId) {
  if (!stockTake?.id) return;
  const state = inputState.get(snapId) || { counted: '', reason: '' };
  const c = (state.counted || '').trim();
  const counted_qty = c === '' ? null : parseFloat(c);
  try {
    await fetch(`/api/stock-take/items/${snapId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ counted_qty, reason: state.reason || '' }),
    });
  } catch (_) {
    // silent — submit will be the authoritative save
  }
}

// Update a single row/card in place without re-rendering the whole list
function updateRow(snapId) {
  const snap = snapshotItems.find(s => s.id === snapId);
  if (!snap) return;
  const state   = inputState.get(snapId) || { counted: '', reason: '' };
  const hasC    = hasCount(snapId);
  const counted = parseFloat(state.counted);
  const variance = hasC ? (counted - (parseFloat(snap.expected_qty) || 0)) : null;
  const showReason = hasC && variance !== 0;

  // Find the table row
  const tr = document.querySelector(`tr[data-snap-id="${cssEscape(snapId)}"]`);
  if (tr) {
    tr.classList.remove('has-count', 'has-variance');
    if (hasC) tr.classList.add(variance !== 0 ? 'has-variance' : 'has-count');
    const varCell = tr.children[3];
    if (varCell) varCell.innerHTML = varianceHtml(variance, snap.unit);
    const reasonCell = tr.children[4];
    if (reasonCell) {
      const sel = reasonCell.querySelector('select');
      if (sel) {
        sel.classList.toggle('hidden-slot', !showReason);
        if (showReason) sel.removeAttribute('tabindex'); else sel.setAttribute('tabindex', '-1');
      }
    }
  }

  // Find the card
  const card = document.querySelector(`.st-card[data-snap-id="${cssEscape(snapId)}"]`);
  if (card) {
    card.classList.remove('has-count', 'has-variance');
    if (hasC) card.classList.add(variance !== 0 ? 'has-variance' : 'has-count');
    const varSpan = card.querySelector('.st-card-variance-row .st-variance');
    if (varSpan) varSpan.outerHTML = varianceHtml(variance, snap.unit);
    const sel = card.querySelector('.st-reason-select');
    if (sel) {
      sel.classList.toggle('hidden-slot', !showReason);
      if (showReason) sel.removeAttribute('tabindex'); else sel.setAttribute('tabindex', '-1');
    }
  }

  updateProgress();
  updateGroupCounts();
}

function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
}

function updateProgress() {
  const total   = snapshotItems.length;
  const counted = snapshotItems.filter(it => hasCount(it.id)).length;
  const msg = `${counted} of ${total} counted`;
  document.getElementById('stProgress').textContent = msg;
  document.getElementById('stFooterProgress').textContent = msg;
}

function updateGroupCounts() {
  document.querySelectorAll('.st-group').forEach(g => {
    const type = g.dataset.type;
    const items = snapshotItems.filter(it => it.item_type === type);
    const counted = items.filter(it => hasCount(it.id)).length;
    const label = g.querySelector('.st-group-count');
    if (label) label.textContent = `${counted} / ${items.length} counted`;
  });
}

async function cancelStockTake() {
  if (!confirm('Cancel this stock take? Any counts you entered will be discarded.')) return;
  try {
    if (stockTake?.id) {
      await fetch(`/api/stock-take/${stockTake.id}/cancel`, { method: 'POST' });
    }
    window.location.href = '/inventory.html';
  } catch (e) {
    showToast('Cancel failed: ' + e.message, 'error');
  }
}

async function submitStockTake() {
  if (!stockTake?.id) return;
  const counted = snapshotItems.filter(it => hasCount(it.id));
  if (!counted.length) {
    if (!confirm('No items have been counted. Submit anyway? All items will be flagged "not counted".')) return;
  }

  // Validate: any counted item with variance !== 0 must have a reason
  const missing = counted.filter(it => {
    const state = inputState.get(it.id);
    const variance = parseFloat(state.counted) - (parseFloat(it.expected_qty) || 0);
    return variance !== 0 && !(state.reason && state.reason.trim());
  });
  if (missing.length) {
    showToast(`Select a reason for ${missing.length} item${missing.length > 1 ? 's' : ''} with a variance.`, 'error');
    // Scroll the first missing one into view
    const el = document.querySelector(`.st-reason-select[data-snap-id="${cssEscape(missing[0].id)}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const payload = {
    items: snapshotItems.map(it => {
      const state = inputState.get(it.id) || { counted: '', reason: '' };
      const c = (state.counted || '').trim();
      return {
        stock_take_item_id: it.id,
        counted_qty: c === '' ? null : parseFloat(c),
        reason: state.reason || '',
      };
    }),
  };

  const btn = document.getElementById('stSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting…';

  try {
    const res = await fetch(`/api/stock-take/${stockTake.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    showToast(`Stock take submitted — ${data.counted} item${data.counted === 1 ? '' : 's'} counted.`, 'success');
    setTimeout(() => { window.location.href = '/inventory.html'; }, 900);
  } catch (e) {
    showToast('Submit failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check"></i> Submit Stock Take';
  }
}
