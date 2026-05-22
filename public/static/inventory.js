/* ===== inventory.js ===== */

const INV_TABLE  = 'inventory';
const LOG_TABLE  = 'stock_log';

let allInventory   = [];   // full inventory rows
let activeFilter   = 'raw_material';
let invSearchQuery = '';
let priceMap       = {};   // keyed by item_id → price info object
let stockTakeStatusMap = {}; // keyed by inventory.id → 'counted' | 'not_counted'

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('inventory-page-marker')) return;

  await loadInventory();

  // Filter tabs
  document.querySelectorAll('.inv-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.inv-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.type;
      renderInventory();
    });
  });

  // Search
  document.getElementById('invSearch').addEventListener('input', e => {
    invSearchQuery = e.target.value.trim();
    renderInventory();
  });

  // Stock log
  document.getElementById('showLogBtn').addEventListener('click', openLogModal);
  document.getElementById('closeLogModal').addEventListener('click', () => closeModal('logModal'));
  document.getElementById('closeLogBtn').addEventListener('click',   () => closeModal('logModal'));
  document.getElementById('logModal').addEventListener('click', e => {
    if (e.target === document.getElementById('logModal')) closeModal('logModal');
  });
  document.getElementById('applyLogFilterBtn').addEventListener('click', () => renderLogTable());
  document.getElementById('clearLogFilterBtn').addEventListener('click', () => {
    document.getElementById('logDateFrom').value = '';
    document.getElementById('logDateTo').value   = '';
    renderLogTable();
  });
  document.getElementById('clearLogBtn').addEventListener('click', clearStockLog);

  // Adjust modal
  document.getElementById('closeAdjustModal').addEventListener('click', () => closeModal('adjustModal'));
  document.getElementById('cancelAdjustModal').addEventListener('click', () => closeModal('adjustModal'));
  document.getElementById('adjustModal').addEventListener('click', e => {
    if (e.target === document.getElementById('adjustModal')) closeModal('adjustModal');
  });
  document.getElementById('saveAdjustBtn').addEventListener('click', applyAdjustment);

  // Live preview in adjust modal
  document.getElementById('adjustQty').addEventListener('input',    updateAdjustPreview);
  document.getElementById('adjustType').addEventListener('change',  updateAdjustPreview);
});

// ── Load & Render ──────────────────────────────────────────────
async function loadInventory() {
  try {
    // Fetch inventory + all price reference tables in parallel
    const [invData, gdData, edData, recData, fpData] = await Promise.all([
      apiGet(`tables/${INV_TABLE}?page=1&limit=500`),
      apiGet(`tables/generic_products?page=1&limit=500`),
      apiGet(`tables/product_entries?page=1&limit=1000`),
      apiGet(`tables/recipes?page=1&limit=500`),
      apiGet(`tables/finished_products?page=1&limit=500`),
    ]);
    allInventory = invData.data || [];
    priceMap = buildPriceMap(
      allInventory,
      gdData.data  || [],
      edData.data  || [],
      recData.data || [],
      fpData.data  || []
    );

    // Fetch stock-take statuses (fire-and-forget — render even if it fails)
    try {
      const st = await apiGet('stock-take/latest-statuses');
      stockTakeStatusMap = st.statuses || {};
    } catch (_) {
      stockTakeStatusMap = {};
    }

    renderInventory();
    renderInvStats();
  } catch (e) {
    document.getElementById('invBody').innerHTML =
      `<tr><td colspan="7" class="empty-row"><i class="fas fa-exclamation-triangle"></i> Failed to load inventory.</td></tr>`;
  }
}

/**
 * Build a map of item_id → price info, used to populate the Price column.
 *
 * Raw material  → live FIFO cost/unit (same algorithm as recipes.js)
 * Batch         → total recipe cost (what it cost to make it) + cost per yield unit
 * Finished prod → cost per unit packed + selling price
 */
function buildPriceMap(inventory, generics, entries, recipes, finishedProducts) {
  const map = {};

  // ── Raw Materials: FIFO active entry cost/unit ──────────────
  inventory.filter(r => r.item_type === 'raw_material').forEach(r => {
    const g = generics.find(x => x.id === r.item_id);
    if (!g) { map[r.item_id] = null; return; }

    const myEntries = entries
      .filter(e => e.generic_product_id === g.id)
      .sort((a, b) => (a.purchase_date || '') > (b.purchase_date || '') ? 1 : -1);

    if (!myEntries.length) { map[r.item_id] = null; return; }

    const invQty  = parseFloat(r.quantity) || 0;
    const active  = invFifoActiveEntry(myEntries, invQty);
    const cpu     = parseFloat(active.cost_per_unit) || 0;
    const pUnit   = active.pack_unit || 'unit';

    map[r.item_id] = { type: 'raw', cpu, unit: pUnit, invQty };
  });

  // ── Batches: recipe total cost + cost per yield unit ────────
  inventory.filter(r => r.item_type === 'batch').forEach(r => {
    const recipe = recipes.find(x => x.id === r.item_id);
    if (!recipe) { map[r.item_id] = null; return; }
    const totalCost  = parseFloat(recipe.total_cost) || 0;
    const servings   = parseFloat(recipe.servings)   || 1;
    const yieldUnit  = recipe.yield_unit || 'unit';
    map[r.item_id] = { type: 'batch', totalCost, cpu: totalCost / servings, unit: yieldUnit };
  });

  // ── Finished Products: cost/unit + selling price ─────────────
  inventory.filter(r => r.item_type === 'finished_product').forEach(r => {
    const fp = finishedProducts.find(x => x.id === r.item_id);
    if (!fp) { map[r.item_id] = null; return; }
    const totalCost    = parseFloat(fp.total_cost)    || 0;
    const sellingPrice = parseFloat(fp.selling_price) || 0;
    const qty          = parseFloat(r.quantity)       || 1;
    map[r.item_id] = { type: 'finished', costPerUnit: qty > 0 ? totalCost / qty : totalCost, sellingPrice, totalCost };
  });

  return map;
}

/**
 * FIFO active entry — same algorithm as recipes.js fifoActiveEntry().
 * Kept local so inventory.js has no dependency on recipes.js.
 */
function invFifoActiveEntry(sortedEntries, invQty) {
  if (!sortedEntries.length) return sortedEntries[0];
  let totalPurchased = 0;
  for (const e of sortedEntries) {
    totalPurchased += parseFloat(e.pack_qty) || 1;
  }
  const consumed = Math.max(0, totalPurchased - Math.max(0, invQty));
  let cumulative = 0;
  for (const e of sortedEntries) {
    const pQty = parseFloat(e.pack_qty) || 1;
    cumulative += pQty;
    if (cumulative > consumed) return e;
  }
  return sortedEntries[sortedEntries.length - 1];
}

function renderInventory() {
  const tbody  = document.getElementById('invBody');
  const thead  = document.querySelector('#invTable thead tr');
  let list = allInventory.filter(r => r.item_type === activeFilter);

  if (invSearchQuery) {
    const q = invSearchQuery.toLowerCase();
    list = list.filter(r =>
      (r.item_name || '').toLowerCase().includes(q) ||
      (r.category  || '').toLowerCase().includes(q) ||
      (r.unit      || '').toLowerCase().includes(q)
    );
  }

  // Update price column header label to match the active tab
  const priceHeader = document.getElementById('invPriceHeader');
  if (priceHeader) {
    if (activeFilter === 'raw_material')      priceHeader.textContent = 'Stock Value';
    else if (activeFilter === 'batch')        priceHeader.textContent = 'Batch Cost';
    else if (activeFilter === 'finished_product') priceHeader.textContent = 'Cost / Unit  |  Selling';
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">
      <i class="fas fa-box-open"></i> No ${filterLabel(activeFilter).toLowerCase()} in inventory yet.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(r => {
    const qty      = parseFloat(r.quantity) || 0;
    const qtyClass = qty <= 0 ? 'inv-qty-zero' : 'inv-qty-ok';
    const updated  = fmtDateTime(r.updated_at);
    const priceCell = buildPriceCell(r);

    const notCounted = stockTakeStatusMap[r.id] === 'not_counted';
    const badge = notCounted
      ? `<span class="inv-not-counted-dot" title="Not counted in the last stock take"></span>`
      : '';

    return `
      <tr>
        <td><strong>${esc(r.item_name)}</strong>${badge}</td>
        <td>${r.category ? `<span class="category-badge cat-${slugify(r.category)}">${esc(r.category)}</span>` : '—'}</td>
        <td><span class="inv-qty ${qtyClass}">${qty % 1 === 0 ? qty : qty.toFixed(3)}</span></td>
        <td>${esc(r.unit || '—')}</td>
        <td>${priceCell}</td>
        <td style="color:var(--text-muted);font-size:.8rem">${updated}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-primary btn-icon" onclick="openAdjustModal('${esc(r.id)}')" title="Adjust stock">
            <i class="fas fa-sliders-h"></i>
          </button>
          <button class="btn btn-danger btn-icon" onclick="deleteInventoryItem('${esc(r.id)}','${esc(r.item_name)}')" title="Delete item">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function buildPriceCell(r) {
  const info = priceMap[r.item_id];
  if (!info) return '<span style="color:var(--text-muted);font-size:.8rem">—</span>';

  if (info.type === 'raw') {
    const stockValue = info.cpu * info.invQty;
    return `<span style="font-weight:600;color:#0f172a">${fmt(stockValue)}</span>`;
  }

  if (info.type === 'batch') {
    return `<div style="line-height:1.5">
      <div><span style="font-weight:600;color:#0f172a">${fmt(info.totalCost)}</span>
        <span style="color:var(--text-muted);font-size:.78rem"> total</span></div>
      <div style="font-size:.8rem;color:#4f46e5">${fmt(info.cpu)} / ${esc(info.unit)}</div>
    </div>`;
  }

  if (info.type === 'finished') {
    const qty = parseFloat(r.quantity) || 1;
    const cpu = qty > 0 ? info.totalCost / qty : info.totalCost;
    return `<div style="line-height:1.5">
      <div><span style="font-weight:600;color:#0f172a">${fmt(cpu)}</span>
        <span style="color:var(--text-muted);font-size:.78rem"> / unit cost</span></div>
      ${info.sellingPrice > 0
        ? `<div style="font-size:.8rem;color:#059669">${fmt(info.sellingPrice)} / unit selling</div>`
        : '<div style="font-size:.78rem;color:var(--text-muted)">No selling price set</div>'}
    </div>`;
  }

  return '—';
}

function renderInvStats() {
  const el  = document.getElementById('invStats');
  const raw = allInventory.filter(r => r.item_type === 'raw_material').length;
  const bat = allInventory.filter(r => r.item_type === 'batch').length;
  const fin = allInventory.filter(r => r.item_type === 'finished_product').length;
  const oos = allInventory.filter(r => (parseFloat(r.quantity) || 0) <= 0).length;

  el.innerHTML = `
    <div class="stat-chip"><i class="fas fa-seedling"></i> ${raw} Raw Materials</div>
    <div class="stat-chip" style="background:#e0e7ff;color:#3730a3"><i class="fas fa-blender"></i> ${bat} Batches</div>
    <div class="stat-chip" style="background:#dcfce7;color:#166534"><i class="fas fa-box-open"></i> ${fin} Finished Products</div>
    ${oos > 0 ? `<div class="stat-chip" style="background:#fee2e2;color:#991b1b"><i class="fas fa-exclamation-circle"></i> ${oos} Out of Stock</div>` : ''}
  `;
}

function filterLabel(type) {
  return { raw_material: 'Raw Materials', batch: 'Batches', finished_product: 'Finished Products' }[type] || type;
}

// ── Manual Adjust Modal ────────────────────────────────────────
function openAdjustModal(invId) {
  const row = allInventory.find(r => r.id === invId);
  if (!row) return;

  document.getElementById('adjustInvId').value        = invId;
  document.getElementById('adjustItemLabel').textContent = row.item_name;
  document.getElementById('adjustCurrentStock').textContent =
    `${parseFloat(row.quantity) || 0} ${row.unit || ''}`;
  document.getElementById('adjustUnitLabel').textContent   = row.unit || 'unit';
  document.getElementById('adjustType').value  = 'add';
  document.getElementById('adjustQty').value   = '';
  document.getElementById('adjustReason').value = '';
  updateAdjustPreview();
  openModal('adjustModal');
}

function updateAdjustPreview() {
  const invId   = document.getElementById('adjustInvId').value;
  const row     = allInventory.find(r => r.id === invId);
  const current = parseFloat(row?.quantity) || 0;
  const type    = document.getElementById('adjustType').value;
  const qty     = parseFloat(document.getElementById('adjustQty').value) || 0;
  const unit    = row?.unit || 'unit';
  const preview = document.getElementById('adjustPreview');
  const text    = document.getElementById('adjustPreviewText');

  preview.classList.remove('ready', 'error');

  if (!qty) {
    text.textContent = 'Enter a quantity to preview the change';
    return;
  }

  let newQty;
  if (type === 'add')    newQty = current + qty;
  if (type === 'remove') newQty = current - qty;
  if (type === 'set')    newQty = qty;

  const change = newQty - current;
  const arrow  = change >= 0 ? '▲' : '▼';
  preview.classList.add(newQty >= 0 ? 'ready' : 'error');
  text.textContent =
    `${current} ${unit}  ${arrow}  ${newQty.toFixed(3).replace(/\.?0+$/, '')} ${unit}  (${change >= 0 ? '+' : ''}${change.toFixed(3).replace(/\.?0+$/, '')} ${unit})`;
}

async function applyAdjustment() {
  const invId  = document.getElementById('adjustInvId').value;
  const row    = allInventory.find(r => r.id === invId);
  if (!row) return;

  const type   = document.getElementById('adjustType').value;
  const qty    = parseFloat(document.getElementById('adjustQty').value);
  const reason = document.getElementById('adjustReason').value.trim() || 'Manual adjustment';

  if (isNaN(qty) || qty <= 0) { showToast('Enter a valid quantity.', 'error'); return; }

  const current = parseFloat(row.quantity) || 0;
  let newQty;
  if (type === 'add')    newQty = current + qty;
  if (type === 'remove') newQty = current - qty;
  if (type === 'set')    newQty = qty;

  const change = newQty - current;

  const btn = document.getElementById('saveAdjustBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    await apiPatch(`tables/${INV_TABLE}/${invId}`, { quantity: newQty });
    await logStockMove({
      inventory_id: invId,
      item_id:      row.item_id,
      item_type:    row.item_type,
      item_name:    row.item_name,
      change,
      reason,
      lot_number:   '',
    });
    showToast('Stock updated!', 'success');
    closeModal('adjustModal');
    await loadInventory();
  } catch (e) {
    showToast('Failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check"></i> Apply Adjustment';
  }
}

// ── Stock Log Modal ────────────────────────────────────────────
let allLogEntries = []; // cached after first fetch

async function openLogModal() {
  openModal('logModal');
  // Reset filters on fresh open
  document.getElementById('logDateFrom').value = '';
  document.getElementById('logDateTo').value   = '';
  await fetchLogEntries();
  renderLogTable();
}

async function fetchLogEntries() {
  const tbody = document.getElementById('logBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-row"><i class="fas fa-spinner fa-spin"></i> Loading…</td></tr>';
  try {
    const data   = await apiGet(`tables/${LOG_TABLE}?page=1&limit=1000`);
    allLogEntries = (data.data || []).slice().reverse(); // newest first
  } catch (e) {
    allLogEntries = [];
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Failed to load log.</td></tr>';
  }
}

function renderLogTable() {
  const tbody   = document.getElementById('logBody');
  const fromVal = document.getElementById('logDateFrom').value; // 'YYYY-MM-DD' or ''
  const toVal   = document.getElementById('logDateTo').value;

  // Build date boundaries (inclusive)
  const fromDate = fromVal ? new Date(fromVal + 'T00:00:00') : null;
  const toDate   = toVal   ? new Date(toVal   + 'T23:59:59') : null;

  let logs = allLogEntries;
  if (fromDate) logs = logs.filter(l => new Date(l.moved_at || l.created_at) >= fromDate);
  if (toDate)   logs = logs.filter(l => new Date(l.moved_at || l.created_at) <= toDate);

  // Update count label
  const countEl = document.getElementById('logCount');
  if (countEl) {
    countEl.textContent = logs.length
      ? `${logs.length} movement${logs.length !== 1 ? 's' : ''}${(fromDate || toDate) ? ' (filtered)' : ''}`
      : '';
  }

  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">${(fromDate || toDate) ? 'No movements found in this date range.' : 'No stock movements yet.'}</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(l => {
    const change    = parseFloat(l.change) || 0;
    const sign      = change >= 0 ? '+' : '';
    const chipClass = change >= 0 ? 'inv-change-in' : 'inv-change-out';
    const typeLabel = filterLabel(l.item_type);
    const date      = fmtDateTime(l.moved_at);
    return `
      <tr>
        <td style="font-size:.8rem;color:var(--text-muted)">${date}</td>
        <td><strong>${esc(l.item_name)}</strong></td>
        <td><span class="inv-type-badge">${esc(typeLabel)}</span></td>
        <td><span class="inv-change-chip ${chipClass}">${sign}${change.toFixed(3).replace(/\.?0+$/, '')}</span></td>
        <td>${esc(l.reason || '—')}</td>
        <td style="color:var(--text-muted);font-size:.8rem">${esc(l.lot_number || '—')}</td>
      </tr>
    `;
  }).join('');
}

async function clearStockLog() {
  if (!confirm('Clear the entire stock movement log? This cannot be undone.')) return;
  const btn = document.getElementById('clearLogBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing…';
  try {
    // Fetch all log entries and delete them one by one
    const data = await apiGet(`tables/${LOG_TABLE}?page=1&limit=1000`);
    const entries = data.data || [];
    for (const entry of entries) {
      await apiDelete(`tables/${LOG_TABLE}/${entry.id}`);
    }
    allLogEntries = [];
    renderLogTable();
    showToast('Stock log cleared.', 'warning');
  } catch (e) {
    showToast('Failed to clear log: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-trash"></i> Clear All Log';
  }
}

// ── Delete Inventory Item ─────────────────────────────────────
async function deleteInventoryItem(invId, itemName) {
  if (!confirm(`Delete "${itemName}" from inventory?\nThis will also remove its stock log entries. This cannot be undone.`)) return;
  try {
    // Delete all stock log entries for this inventory row
    const logData = await apiGet(`tables/${LOG_TABLE}?page=1&limit=1000`);
    const logs    = (logData.data || []).filter(l => l.inventory_id === invId);
    for (const l of logs) await apiDelete(`tables/${LOG_TABLE}/${l.id}`);

    // Delete the inventory row itself
    await apiDelete(`tables/${INV_TABLE}/${invId}`);

    showToast(`"${itemName}" removed from inventory.`, 'warning');
    await loadInventory();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

// ── Shared inventory helpers (used by recipes.js & finished-products.js) ──

/**
 * Find an existing inventory row for this item, or return null.
 */
async function findInvRow(itemId, itemType) {
  try {
    const data = await apiGet(`tables/${INV_TABLE}?page=1&limit=500`);
    return (data.data || []).find(r => r.item_id === itemId && r.item_type === itemType) || null;
  } catch (_) { return null; }
}

/**
 * Upsert an inventory row: create if not exists, patch quantity if exists.
 * change: positive = add, negative = deduct.
 * Returns the updated inventory row.
 */
async function upsertInventory({ itemId, itemType, itemName, category, unit, change, reason, lotNumber = '' }) {
  let row = await findInvRow(itemId, itemType);
  const now = new Date().toISOString();

  if (row) {
    const newQty = (parseFloat(row.quantity) || 0) + change;
    await apiPatch(`tables/${INV_TABLE}/${row.id}`, { quantity: newQty });
    row = { ...row, quantity: newQty };
  } else {
    row = await apiPost(`tables/${INV_TABLE}`, {
      item_id:   itemId,
      item_type: itemType,
      item_name: itemName,
      category,
      quantity:  change,
      unit,
    });
  }

  // Log the movement
  await logStockMove({
    inventory_id: row.id,
    item_id:      itemId,
    item_type:    itemType,
    item_name:    itemName,
    change,
    reason,
    lot_number:   lotNumber,
    moved_at:     now,
  });

  return row;
}

/**
 * Write a line to the stock log.
 */
async function logStockMove({ inventory_id, item_id, item_type, item_name, change, reason, lot_number = '', moved_at }) {
  await apiPost(`tables/${LOG_TABLE}`, {
    inventory_id,
    item_id,
    item_type,
    item_name,
    change,
    reason:     reason || '',
    lot_number: lot_number || '',
    moved_at:   moved_at || new Date().toISOString(),
  });
}

// Expose helpers globally so other JS files can call them
window.invHelpers = { upsertInventory, findInvRow, logStockMove };
