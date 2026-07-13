/* ===== stock-take.js ===== */

let stockTake = null;        // the active stock_takes row
let snapshotItems = [];      // stock_take_items rows (snapshot of inventory at start)
// In-memory state per snapshot id: { counted: string, reason: string }
const inputState = new Map();
// Debounce timers for autosave per snapshot id
const saveTimers = new Map();

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

    // Seed inputState from any previously-entered values on resume
    for (const it of snapshotItems) {
      const hasCount = it.counted_qty !== null && it.counted_qty !== undefined;
      inputState.set(it.id, {
        counted: hasCount ? String(it.counted_qty) : '',
        reason:  it.reason || '',
      });
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
  return `
    <tr class="${rowCls}" data-snap-id="${esc(it.id)}">
      <td>
        <div class="st-name">${esc(it.item_name)}</div>
        ${it.category ? `<div class="st-cat">${esc(it.category)}</div>` : ''}
      </td>
      <td><span class="st-expected">${fmtQty(it.expected_qty)}<span class="unit">${esc(it.unit || '')}</span></span></td>
      <td>
        <input type="number" step="any" class="st-input st-count-input"
               data-snap-id="${esc(it.id)}"
               value="${esc(counted)}"
               placeholder="0" />
      </td>
      <td>${varianceHtml(variance, it.unit)}</td>
      <td>${reasonHtml(it.id, reason, hasC && variance !== 0)}</td>
    </tr>
  `;
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
          <input type="number" step="any" class="st-input st-count-input"
                 data-snap-id="${esc(it.id)}"
                 value="${esc(counted)}"
                 placeholder="0" />
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
  document.querySelectorAll('.st-reason-select').forEach(el => {
    el.addEventListener('change', onReasonChange);
  });
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
