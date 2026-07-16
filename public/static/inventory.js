/* ===== inventory.js ===== */

const INV_TABLE  = 'inventory';
const LOG_TABLE  = 'stock_log';

let allInventory   = [];   // full inventory rows
let activeFilter   = null;  // null = All; else 'raw_material' | 'batch' | 'finished_product' | 'out_of_stock'
let activeCategory = null;  // sub-filter, only applies when activeFilter === 'raw_material'
let invSearchQuery = '';
let priceMap       = {};   // keyed by item_id → price info object
let stockTakeStatusMap = {}; // keyed by inventory.id → 'counted' | 'not_counted'
let allGenericInv  = [];   // generic_products cache (for the in-place product editor)
let invCategories  = [];   // category master-list names (for the in-place editor dropdown)
let invCatType     = {};   // lowercased category name → 'food' | 'beverage' | 'supplies'

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('inventory-page-marker')) return;

  await loadInventory();

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

  // In-place product editor modal
  document.getElementById('closeInvEditModal').addEventListener('click',  () => closeModal('invEditProductModal'));
  document.getElementById('cancelInvEditModal').addEventListener('click', () => closeModal('invEditProductModal'));
  document.getElementById('invEditProductModal').addEventListener('click', e => {
    if (e.target === document.getElementById('invEditProductModal')) closeModal('invEditProductModal');
  });
  document.getElementById('saveInvEditBtn').addEventListener('click', saveInvEditProduct);
});

// ── Load & Render ──────────────────────────────────────────────
async function loadInventory() {
  try {
    // Fetch inventory + all price reference tables in parallel
    const [invData, gdData, edData, recData, fpData, catData] = await Promise.all([
      apiGet(`tables/${INV_TABLE}?page=1&limit=500`),
      apiGet(`tables/generic_products?page=1&limit=500`),
      apiGet(`tables/product_entries?page=1&limit=1000`),
      apiGet(`tables/recipes?page=1&limit=500`),
      apiGet(`tables/finished_products?page=1&limit=500`),
      apiGet(`tables/categories?page=1&limit=200`),
    ]);
    allInventory = invData.data || [];
    allGenericInv = gdData.data || [];
    const catRows = catData.data || [];
    invCategories = catRows
      .slice()
      .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name))
      .map(c => c.name);
    invCatType = {};
    catRows.forEach(c => { invCatType[(c.name || '').trim().toLowerCase()] = c.type || 'food'; });
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

// Cost-group type of a category name (falls back to the built-in map, then food).
function _catType(name) {
  const key = (name || '').trim().toLowerCase();
  if (key && invCatType[key]) return invCatType[key];
  if (typeof DEFAULT_CATEGORY_TYPES !== 'undefined') {
    const hit = Object.keys(DEFAULT_CATEGORY_TYPES).find(k => k.toLowerCase() === key);
    if (hit) return DEFAULT_CATEGORY_TYPES[hit];
  }
  return 'food';
}
// Top-level bucket for a raw-material row. 2-bucket mode: beverage folds into food.
function _itemBucket(r) {
  return _catType(r.category) === 'supplies' ? 'supplies' : 'food';
}

// A raw-material row is "low stock" when its product has a reorder_level set and
// the live quantity has fallen to or below it — but is still above zero (zero is
// the separate "Out of Stock" bucket). Only raw materials carry a reorder level.
function _reorderInfo(r) {
  if (r.item_type !== 'raw_material') return null;
  const g = allGenericInv.find(p => p.id === r.item_id);
  const lvl = g && g.reorder_level != null && g.reorder_level !== '' ? parseFloat(g.reorder_level) : NaN;
  if (isNaN(lvl)) return null;
  return { level: lvl, unit: g.reorder_unit || '' };
}
function _isLowStock(r) {
  const info = _reorderInfo(r);
  if (!info) return false;
  const qty = parseFloat(r.quantity) || 0;
  return qty > 0 && qty <= info.level;
}

function renderInventory() {
  const tbody  = document.getElementById('invBody');
  const thead  = document.querySelector('#invTable thead tr');
  let list;
  if (activeFilter === null)                     list = allInventory.slice();                                    // All
  else if (activeFilter === 'out_of_stock')      list = allInventory.filter(r => (parseFloat(r.quantity) || 0) <= 0);
  else if (activeFilter === 'low_stock')         list = allInventory.filter(_isLowStock);
  else if (activeFilter === 'food' || activeFilter === 'supplies')
    list = allInventory.filter(r => r.item_type === 'raw_material' && _itemBucket(r) === activeFilter);
  else                                           list = allInventory.filter(r => r.item_type === activeFilter);

  // Category sub-filter — only meaningful inside a raw-material bucket
  if ((activeFilter === 'food' || activeFilter === 'supplies') && activeCategory) {
    list = list.filter(r => ((r.category || '').trim() || 'Uncategorised') === activeCategory);
  }

  if (invSearchQuery) {
    const q = invSearchQuery.toLowerCase();
    list = list.filter(r =>
      (r.item_name || '').toLowerCase().includes(q) ||
      (r.category  || '').toLowerCase().includes(q) ||
      (r.unit      || '').toLowerCase().includes(q)
    );
  }

  // Always show items A→Z by name (predictable ordering in every view — chips
  // handle grouping, so "All" is just a flat alphabetical list).
  list.sort((a, b) => (a.item_name || '').localeCompare(b.item_name || '', undefined, { sensitivity: 'base' }));

  // Update price column header label to match the active filter
  const priceHeader = document.getElementById('invPriceHeader');
  if (priceHeader) {
    if (activeFilter === 'food' || activeFilter === 'supplies') priceHeader.textContent = 'Stock Value';
    else if (activeFilter === 'batch')            priceHeader.textContent = 'Batch Cost';
    else if (activeFilter === 'finished_product') priceHeader.textContent = 'Cost / Unit  |  Selling';
    else                                          priceHeader.textContent = 'Value';   // All / Out of Stock (mixed types)
  }

  if (!list.length) {
    const emptyLabel = activeFilter === null           ? 'items'
                     : activeFilter === 'out_of_stock' ? 'out-of-stock items'
                     : activeFilter === 'low_stock'    ? 'low-stock items'
                     : activeFilter === 'food'         ? 'food items'
                     : activeFilter === 'supplies'     ? 'supplies'
                     : filterLabel(activeFilter).toLowerCase();
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">
      <i class="fas fa-box-open"></i> No ${emptyLabel} in inventory yet.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(r => {
    const qty      = parseFloat(r.quantity) || 0;
    const qtyClass = qty <= 0 ? 'inv-qty-zero' : 'inv-qty-ok';
    const updated  = fmtDateTime(r.updated_at);
    const priceCell = buildPriceCell(r);

    // Low-stock pill: shown when the item is at/below its reorder level (but not
    // yet zero). Includes the threshold so it reads e.g. "Low ≤ 5 lb".
    const lowInfo = _reorderInfo(r);
    const lowPill = _isLowStock(r)
      ? ` <span class="inv-low-pill" title="At or below reorder level"><i class="fas fa-triangle-exclamation"></i> Low ≤ ${lowInfo.level}${lowInfo.unit ? ' ' + esc(lowInfo.unit) : ''}</span>`
      : '';

    const notCounted = stockTakeStatusMap[r.id] === 'not_counted';
    const badge = notCounted
      ? `<span class="inv-not-counted-dot" title="Not counted in the last stock take"></span>`
      : '';

    // Raw materials are generic products (item_id = generic_products.id). Click
    // opens a focused name/category editor in place (stays on the Inventory page);
    // the href is a fallback so open-in-new-tab still lands on the full product.
    const nameHtml = r.item_type === 'raw_material'
      ? `<a class="inv-name-link" href="/index.html#${esc(r.item_id)}" onclick="openInvEditProduct('${esc(r.item_id)}');return false;" title="Edit name / category"><strong>${esc(r.item_name)}</strong></a>`
      : `<strong>${esc(r.item_name)}</strong>`;

    return `
      <tr>
        <td>${nameHtml}${badge}</td>
        <td>${r.category ? `<span class="category-badge cat-${slugify(r.category)}">${esc(r.category)}</span>` : '—'}</td>
        <td><span class="inv-qty ${qtyClass}">${qty % 1 === 0 ? qty : qty.toFixed(3)}</span>${lowPill}</td>
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

// The stat chips double as the type filter (same pattern as the Products page):
// click a chip to filter, click the active chip again — or the "All" chip — to clear.
function renderInvStats() {
  const el  = document.getElementById('invStats');
  const total = allInventory.length;
  const rawRows = allInventory.filter(r => r.item_type === 'raw_material');
  const food = rawRows.filter(r => _itemBucket(r) === 'food').length;
  const sup  = rawRows.filter(r => _itemBucket(r) === 'supplies').length;
  const bat = allInventory.filter(r => r.item_type === 'batch').length;
  const fin = allInventory.filter(r => r.item_type === 'finished_product').length;
  const oos = allInventory.filter(r => (parseFloat(r.quantity) || 0) <= 0).length;
  const low = allInventory.filter(_isLowStock).length;
  const sel = t => activeFilter === t ? ' stat-chip-selected' : '';

  const mainRow = `
    <div class="inv-chip-row">
      <div class="stat-chip${sel(null)}" style="cursor:pointer" onclick="setInvFilter(null)" title="Show all items"><i class="fas fa-layer-group"></i> ${total} All</div>
      <div class="stat-chip${sel('food')}" style="cursor:pointer;background:#ccfbf1;color:#0f766e" onclick="setInvFilter('food')" title="Show food ingredients"><i class="fas fa-carrot"></i> ${food} Food</div>
      <div class="stat-chip${sel('supplies')}" style="cursor:pointer;background:#fef3c7;color:#92400e" onclick="setInvFilter('supplies')" title="Show supplies (packaging, disposables, linen…)"><i class="fas fa-box"></i> ${sup} Supplies</div>
      <div class="stat-chip${sel('batch')}" style="cursor:pointer;background:#e0e7ff;color:#3730a3" onclick="setInvFilter('batch')" title="Show batches"><i class="fas fa-blender"></i> ${bat} Batches</div>
      <div class="stat-chip${sel('finished_product')}" style="cursor:pointer;background:#dcfce7;color:#166534" onclick="setInvFilter('finished_product')" title="Show finished products"><i class="fas fa-box-open"></i> ${fin} Finished Products</div>
      <div class="stat-chip${sel('low_stock')}" style="cursor:pointer;${low > 0 ? 'background:#fef3c7;color:#92400e' : 'background:#f1f5f9;color:#94a3b8'}" onclick="setInvFilter('low_stock')" title="Show items at or below their reorder level"><i class="fas fa-triangle-exclamation"></i> ${low} Low Stock</div>
      <div class="stat-chip${sel('out_of_stock')}" style="cursor:pointer;${oos > 0 ? 'background:#fee2e2;color:#991b1b' : 'background:#f1f5f9;color:#94a3b8'}" onclick="setInvFilter('out_of_stock')" title="Show out-of-stock items"><i class="fas fa-exclamation-circle"></i> ${oos} Out of Stock</div>
    </div>`;

  // Category sub-chips: only while viewing a raw-material bucket (Food/Supplies),
  // only categories in that bucket that hold stock, taxonomy order (Uncat last).
  let subRow = '';
  if (activeFilter === 'food' || activeFilter === 'supplies') {
    const byCat = new Map();
    rawRows.filter(r => _itemBucket(r) === activeFilter).forEach(r => {
      const key = (r.category || '').trim() || 'Uncategorised';
      byCat.set(key, (byCat.get(key) || 0) + 1);
    });
    let cats = mergeCategories([...byCat.keys()]).filter(c => byCat.has(c));
    if (cats.includes('Uncategorised')) { cats = cats.filter(c => c !== 'Uncategorised'); cats.push('Uncategorised'); }
    if (cats.length) {
      const chips = cats.map(c => {
        const active = activeCategory === c ? ' cat-chip-active' : '';
        const isUncat = c === 'Uncategorised';
        const cls   = isUncat ? 'stat-chip inv-subchip' : `stat-chip inv-subchip cat-chip cat-${slugify(c)}`;
        const style = isUncat ? 'cursor:pointer;background:#f1f5f9;color:#64748b' : 'cursor:pointer';
        return `<div class="${cls}${active}" style="${style}" onclick="setInvCategory('${c.replace(/'/g, "\\'")}')" title="Filter by ${esc(c)}">${esc(c)} ${byCat.get(c)}</div>`;
      }).join('');
      subRow = `<div class="inv-subchip-row">${chips}</div>`;
    }
  }

  el.innerHTML = mainRow + subRow;
}

// Toggle the active type filter: same chip again (or "All") clears back to All.
// Any type change resets the category sub-filter (categories only apply to raw materials).
function setInvFilter(type) {
  activeFilter = (activeFilter === type) ? null : type;
  activeCategory = null;
  renderInvStats();
  renderInventory();
}

// Toggle the category sub-filter within raw materials; same chip again clears it.
function setInvCategory(cat) {
  activeCategory = (activeCategory === cat) ? null : cat;
  renderInvStats();
  renderInventory();
}

function filterLabel(type) {
  return { raw_material: 'Raw Materials', batch: 'Batches', finished_product: 'Finished Products' }[type] || type;
}

// ── In-place product editor (name + category) ──────────────────
// Lets you fix a raw-material's name/category without leaving the Inventory
// page. Saves through PUT /api/generic_products/:id (same endpoint the Products
// page uses), so the name/category sync to inventory & everywhere else applies.
let _invEditProduct = null;   // the full generic_products row being edited

function _fillInvCategorySelect(select, selected) {
  const names = invCategories.length ? invCategories
              : (typeof DEFAULT_CATEGORIES !== 'undefined' ? DEFAULT_CATEGORIES : []);
  select.innerHTML = '<option value="">— Select category —</option>' +
    names.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (selected) {
    let opt = Array.from(select.options).find(o => o.value.toLowerCase() === String(selected).toLowerCase());
    if (!opt) {   // legacy/custom value not in the master list — inject so it stays selected
      opt = document.createElement('option');
      opt.value = selected; opt.textContent = selected;
      select.appendChild(opt);
    }
    select.value = opt.value;
  }
}

function openInvEditProduct(itemId) {
  const g = allGenericInv.find(p => p.id === itemId);
  if (!g) { showToast('Could not load that product.', 'error'); return; }
  _invEditProduct = g;
  document.getElementById('invEditProductId').value = g.id;
  document.getElementById('invEditName').value      = g.name || '';
  _fillInvCategorySelect(document.getElementById('invEditCategory'), g.category || '');
  document.getElementById('invEditFullLink').href   = `/index.html#${g.id}`;
  openModal('invEditProductModal');
}

async function saveInvEditProduct() {
  if (!_invEditProduct) return;
  const id       = _invEditProduct.id;
  const name     = document.getElementById('invEditName').value.trim();
  const category = document.getElementById('invEditCategory').value;
  if (!name)     { showToast('Product name is required.', 'error'); return; }
  if (!category) { showToast('Please select a category.', 'error'); return; }

  const btn = document.getElementById('saveInvEditBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    // Preserve the product's other fields — the cascade endpoint overwrites all
    // of them, so passing only name/category would blank sub-unit / avg-weight.
    await apiPut(`generic_products/${id}`, {
      name,
      category,
      sub_unit_name:       _invEditProduct.sub_unit_name ?? null,
      sub_unit_qty:        _invEditProduct.sub_unit_qty ?? null,
      avg_weight_per_unit: _invEditProduct.avg_weight_per_unit ?? null,
    });
    showToast('Product updated!', 'success');
    closeModal('invEditProductModal');
    await loadInventory();   // refresh names, badges & category chips
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save';
  }
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
