/* ===== utils.js ===== */

// API base — all calls go through /api/tables/:table
const API_BASE = '/api';

// API helpers
async function apiGet(url) {
  const r = await fetch(`${API_BASE}/${url}`);
  if (!r.ok) throw new Error(`GET ${url} failed: ${r.status}`);
  return r.json();
}
async function apiPost(url, data) {
  const r = await fetch(`${API_BASE}/${url}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  if (!r.ok) {
    let msg = `POST ${url} failed: ${r.status}`;
    try { const j = await r.json(); if (j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}
async function apiPut(url, data) {
  const r = await fetch(`${API_BASE}/${url}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  if (!r.ok) throw new Error(`PUT ${url} failed: ${r.status}`);
  return r.json();
}
async function apiPatch(url, data) {
  const r = await fetch(`${API_BASE}/${url}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  if (!r.ok) throw new Error(`PATCH ${url} failed: ${r.status}`);
  return r.json();
}
async function apiDelete(url) {
  const r = await fetch(`${API_BASE}/${url}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`DELETE ${url} failed: ${r.status}`);
}

// Upload a file to R2, returns { key, url, name }
async function apiUploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(`${API_BASE}/upload`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error('File upload failed: ' + r.status);
  return r.json();
}

// Toast
let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = '';
  const icon = document.createElement('i');
  if (type === 'success') { icon.className = 'fas fa-check-circle'; el.className = 'toast toast-success'; }
  else if (type === 'error') { icon.className = 'fas fa-exclamation-circle'; el.className = 'toast toast-error'; }
  else if (type === 'warning') { icon.className = 'fas fa-exclamation-triangle'; el.className = 'toast toast-warning'; }
  else { icon.className = 'fas fa-info-circle'; el.className = 'toast'; }
  el.appendChild(icon);
  el.appendChild(document.createTextNode(' ' + msg));
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// Days remaining until a date string
function daysLeft(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.floor((d - today) / 86400000);
}

// Badge for days left
function daysBadge(days) {
  if (days === null) return '<span class="badge badge-gray"><i class="fas fa-minus"></i> N/A</span>';
  if (days < 0)  return `<span class="badge badge-red"><i class="fas fa-skull-crossbones"></i> Expired ${Math.abs(days)}d ago</span>`;
  if (days <= 7) return `<span class="badge badge-red"><i class="fas fa-fire"></i> ${days}d left</span>`;
  if (days <= 30) return `<span class="badge badge-yellow"><i class="fas fa-clock"></i> ${days}d left</span>`;
  return `<span class="badge badge-green"><i class="fas fa-check"></i> ${days}d left</span>`;
}

// Currency format
function fmt(n) {
  const num = parseFloat(n);
  return isNaN(num) ? '$0.00' : '$' + num.toFixed(2);
}

// Generate simple readable ID
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Escape HTML to prevent XSS
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Modal helpers
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// Slugify a string to CSS-safe class name
function slugify(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Manage Units ──────────────────────────────────────────────────
const _unitRefreshCallbacks = [];
let _manageUnitsCache = [];

function registerUnitRefreshCallback(fn) {
  _unitRefreshCallbacks.push(fn);
}

async function _refreshAllUnitsAndDropdowns() {
  for (const fn of _unitRefreshCallbacks) {
    try { await fn(); } catch (e) { console.error('Unit refresh error', e); }
  }
}

async function openManageUnitsModal() {
  if (!document.getElementById('manageUnitsModal')) return;
  await renderManageUnitsList();
  openModal('manageUnitsModal');
}

async function renderManageUnitsList() {
  const container = document.getElementById('manageUnitsList');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
  try {
    const data = await apiGet('tables/units?page=1&limit=100');
    _manageUnitsCache = (data.data || []).sort((a, b) => a.sort_order - b.sort_order);
    if (!_manageUnitsCache.length) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0">No units defined yet.</div>';
      return;
    }
    container.innerHTML = _manageUnitsCache.map(u => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:.45rem .65rem;border:1px solid var(--border);border-radius:6px;margin-bottom:.35rem;background:#fafbff">
        <span style="font-weight:500;font-size:.92rem">${esc(u.name)}</span>
        <button class="btn btn-danger btn-icon" onclick="deleteUnit(${u.id},'${esc(u.name)}')" title="Delete unit" style="padding:.3rem .55rem;font-size:.78rem">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<div style="color:#dc2626;font-size:.85rem">Failed to load units.</div>';
  }
}

async function addUnit() {
  const input = document.getElementById('newUnitName');
  const errEl = document.getElementById('manageUnitsError');
  const raw = (input?.value || '').trim();

  errEl.style.display = 'none';

  if (!raw) {
    errEl.textContent = 'Please enter a unit name.';
    errEl.style.display = '';
    return;
  }

  // Normalize: lowercase, except 'l' / 'L' (litre) stays uppercase
  const name = raw.toLowerCase() === 'l' ? 'L' : raw.toLowerCase();

  if (_manageUnitsCache.some(u => u.name.toLowerCase() === name.toLowerCase())) {
    errEl.textContent = `Unit "${name}" already exists.`;
    errEl.style.display = '';
    return;
  }

  try {
    await apiPost('tables/units', { name, sort_order: 0 });
    input.value = '';
    await renderManageUnitsList();
    await _refreshAllUnitsAndDropdowns();
  } catch (e) {
    errEl.textContent = e.message || 'Failed to add unit.';
    errEl.style.display = '';
  }
}

async function deleteUnit(id, name) {
  const res = await fetch(`/api/units/${id}`, { method: 'DELETE' });

  if (res.status === 204) {
    await renderManageUnitsList();
    await _refreshAllUnitsAndDropdowns();
    return;
  }

  let data = {};
  try { data = await res.json(); } catch (_) {}

  if (data.warning) {
    const confirmed = confirm(
      `This unit is used by ${data.count} product ${data.count === 1 ? 'entry' : 'entries'}. Are you sure you want to delete it?`
    );
    if (!confirmed) return;
    const res2 = await fetch(`/api/units/${id}?force=true`, { method: 'DELETE' });
    if (res2.status === 204) {
      await renderManageUnitsList();
      await _refreshAllUnitsAndDropdowns();
    } else {
      showToast('Failed to delete unit.', 'error');
    }
    return;
  }

  showToast(data.error || 'Failed to delete unit.', 'error');
}

window.openManageUnitsModal = openManageUnitsModal;
window.addUnit  = addUnit;
window.deleteUnit = deleteUnit;
