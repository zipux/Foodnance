/* ===== products.js (v2 — two-level: generic_products + product_entries) ===== */

const GENERIC_TABLE  = 'generic_products';
const ENTRIES_TABLE  = 'product_entries';
const PAGE_SIZE      = 15;

let currentPage       = 1;
let searchQuery       = '';
let categoryFilter    = null; // null = all, or category string
let showArchived      = false; // true = list archived (soft-deleted) products
let allGeneric        = [];   // generic_products rows
let allEntries        = [];   // product_entries rows
let allSupplierList   = [];   // suppliers rows (for dropdowns)
let allInvoices       = [];   // invoices rows (for invoice number lookup)
let currentGenericId  = null; // which generic product is open in modal
let _pendingEntryInv  = null; // { genericId, entryId, itemName, packQty, packUnit, category }
let allUnits          = [];   // units table rows, sorted by sort_order
let allCategories     = [];   // category names from the categories table (master list)
let _entrySnapshots   = null; // Map<id,{cost_per_unit,pack_unit}> captured when modal opens; null = no pending changes
let _entriesShownCount = 10; // how many entries are visible in the modal table

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('productBody')) return;
  await loadAll();

  const catParam = new URLSearchParams(location.search).get('category');
  if (catParam) setCategoryFilter(catParam);

  document.getElementById('searchInput').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    currentPage = 1;
    renderProductTable();
  });
  document.getElementById('toggleArchivedInput').addEventListener('change', toggleArchivedView);
  document.getElementById('openAddProductModal').addEventListener('click', openAddProductModal);
  // Grouping is launched per product row now (see the Group button in renderProductTable).
document.getElementById('saveProductBtn').addEventListener('click', saveGenericProduct);
  document.getElementById('closeModal').addEventListener('click', () => { _restoreEntrySnapshots(); closeModal('productModal'); });
  document.getElementById('cancelModal').addEventListener('click', () => { _restoreEntrySnapshots(); closeModal('productModal'); });
  document.getElementById('productModal').addEventListener('click', e => {
    if (e.target === document.getElementById('productModal')) { _restoreEntrySnapshots(); closeModal('productModal'); }
  });

  // Entry form controls
  document.getElementById('openAddEntryBtn').addEventListener('click', openAddEntryForm);
  document.getElementById('eCost').addEventListener('input',       updateEntryCostPerUnit);
  document.getElementById('ePackQty').addEventListener('input',    updateEntryCostPerUnit);
  document.getElementById('eQtyOrdered').addEventListener('input', updateEntryCostPerUnit);
  document.getElementById('ePackUnit').addEventListener('change',  onPackUnitChange);

  // Stocking unit drives the pack-size labels (pack weights are in that unit)
  // and the low-stock threshold's unit, so it re-renders the preview too.
  // Pack-sizes section — live preview + reactive labels
  ['pStockUnit', 'pMidName', 'pMidLb', 'pTopName', 'pTopLb'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updatePackPreview);
    if (el) el.addEventListener('change', updatePackPreview);
  });

  // Inventory prompt modal (after saving a supplier entry)
  document.getElementById('closeEntryInvModal').addEventListener('click', () => closeModal('entryInvModal'));
  document.getElementById('skipEntryInvBtn').addEventListener('click',    () => closeModal('entryInvModal'));
  document.getElementById('confirmEntryInvBtn').addEventListener('click', confirmEntryInventory);

  if (location.hash && location.hash.length > 1) {
    const hashId = location.hash.slice(1);
    if (allGeneric.find(g => g.id === hashId)) {
      openEditProduct(hashId);
    }
  }
});

// ── Load everything ────────────────────────────────────────────
async function loadAll() {
  try {
    const [gd, ed, sd, ivd, ud, cd] = await Promise.all([
      apiGet(`tables/${GENERIC_TABLE}?page=1&limit=500`),
      apiGet(`tables/${ENTRIES_TABLE}?page=1&limit=1000`),
      apiGet(`tables/suppliers?page=1&limit=500`),
      apiGet(`tables/invoices?page=1&limit=1000`),
      apiGet(`tables/units?page=1&limit=100`),
      apiGet(`tables/categories?page=1&limit=200`),
    ]);
    allGeneric      = gd.data  || [];
    allEntries      = ed.data  || [];
    allSupplierList = sd.data  || [];
    allInvoices     = ivd.data || [];
    allUnits        = (ud.data || []).slice().sort((a, b) => a.sort_order - b.sort_order);
    allCategories   = (cd.data || [])
      .slice()
      .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name))
      .map(c => c.name);
    populateUnitDropdown(document.getElementById('ePackUnit'));
    refreshCategoryDropdown();
    renderProductTable();
    renderStats();
  } catch (e) {
    console.error(e);
    document.getElementById('productBody').innerHTML =
      `<tr><td colspan="6" class="empty-row"><i class="fas fa-exclamation-triangle"></i> Failed to load products.</td></tr>`;
  }
}

// ── Unit helpers ──────────────────────────────────────────────
function populateUnitDropdown(select, selectedValue) {
  if (!select) return;
  const prev = selectedValue !== undefined ? selectedValue : select.value;
  const seen = new Set();
  const uniqueUnits = allUnits.filter(u => {
    const key = (u.name || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  select.innerHTML = uniqueUnits
    .map(u => `<option value="${u.name}">${u.name}</option>`)
    .join('') +
    '<option value="__manage_units__" style="color:var(--primary);font-style:italic">+ Manage units</option>';
  setSelectValueCI(select, prev);
  select.dataset.prevUnit = select.value;
}

function setSelectValueCI(select, value) {
  if (!value) return;
  const lower = value.toLowerCase();
  const opt = Array.from(select.options).find(o => o.value.toLowerCase() === lower);
  if (opt) select.value = opt.value;
}

// ── Category helpers ──────────────────────────────────────────
// Distinct categories currently saved on products — merged into the dropdown
// and stat chips so user-created categories persist without a DB table.
function usedCategories() {
  return [...new Set(allGeneric.map(g => (g.category || '').trim()).filter(Boolean))];
}

// Repopulate the product-modal category <select> from the DB master list
// (plus any label a product already carries but that isn't in the list),
// preserving the current selection, and (re)attach the action-row handler.
function refreshCategoryDropdown(selectedValue) {
  const sel = document.getElementById('pCategory');
  const names = dedupeNames(allCategories, usedCategories());
  populateCategoryDropdown(sel, selectedValue, names);
  attachNewCategoryHandler(sel);
}

// ── Invoice number lookup ──────────────────────────────────────
function invoiceNumber(invoiceId) {
  if (!invoiceId) return '';
  const inv = allInvoices.find(i => i.id === invoiceId);
  return (inv && inv.invoice_number) ? inv.invoice_number : '';
}

// ── Render generic product table ───────────────────────────────
function filteredGeneric() {
  let list = allGeneric.filter(g => showArchived ? !!g.deleted_at : !g.deleted_at);
  if (categoryFilter) list = list.filter(g => g.category === categoryFilter);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(g =>
      (g.name     || '').toLowerCase().includes(q) ||
      (g.category || '').toLowerCase().includes(q)
    );
  }
  // Always show products A→Z by name (case-insensitive, natural number order)
  return list.sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true })
  );
}

function setCategoryFilter(cat) {
  // Clicking the same tab again clears the filter
  categoryFilter = (categoryFilter === cat) ? null : cat;
  currentPage = 1;
  renderStats();
  renderProductTable();
}

function renderProductTable() {
  const tbody = document.getElementById('productBody');
  const pagi  = document.getElementById('pagination');
  const list  = filteredGeneric();
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > pages) currentPage = 1;
  const slice = list.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (!slice.length) {
    const emptyMsg = showArchived
      ? '<i class="fas fa-box-archive"></i> No archived products.'
      : '<i class="fas fa-box-open"></i> No products found.';
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">${emptyMsg}</td></tr>`;
    pagi.innerHTML = '';
    return;
  }

  tbody.innerHTML = slice.map(g => {
    const entries      = allEntries.filter(e => e.generic_product_id === g.id);
    const supplierCount = [...new Set(entries.map(e => e.supplier_name).filter(Boolean))].length;
    const latestSupplierName = [...entries].reverse().find(e => e.supplier_name)?.supplier_name || '';
    const supplierLabel = supplierCount === 0
      ? '<span style="color:var(--text-muted);font-size:.8rem">—</span>'
      : supplierCount === 1
        ? `<span class="entry-count-badge">${esc(latestSupplierName)}</span>`
        : `<span class="entry-count-badge">${supplierCount} vendors</span>`;

    // Latest cost per unit — the most recent purchase (what you're paying now),
    // not the historical lowest which could be a year old. Newest-first sort
    // matches the product detail modal so the two views agree.
    // Prefer stored cost_per_unit; fall back to computing from cost/pack_qty.
    const latestEntry = [...entries]
      .sort((a, b) => (b.purchase_date || b.created_at || '') > (a.purchase_date || a.created_at || '') ? 1 : -1)[0];
    let latestCpu = null;
    let latestUnit = '';
    if (latestEntry) {
      latestCpu = (latestEntry.cost_per_unit != null && latestEntry.cost_per_unit > 0)
        ? latestEntry.cost_per_unit
        : (entryPackQty(latestEntry) > 0 ? latestEntry.cost / entryPackQty(latestEntry) : latestEntry.cost);
      latestUnit = entryPackUnit(latestEntry);
    }

    // Most recent purchase date
    const dates = entries.map(e => e.purchase_date).filter(Boolean).sort().reverse();
    const lastPurchase = dates[0] ? fmtDate(dates[0]) : '—';

    if (showArchived) {
      const archivedOn = g.deleted_at ? fmtDate(String(g.deleted_at).slice(0, 10)) : '—';
      return `
        <tr class="product-row product-row--archived" title="Archived product">
          <td><strong>${esc(g.name)}</strong></td>
          <td>${g.category ? `<span class="category-badge cat-${slugify(g.category)}">${esc(g.category)}</span>` : '—'}</td>
          <td>${supplierLabel}</td>
          <td>${latestCpu !== null ? fmt(latestCpu) + ' / ' + esc(latestUnit) : '—'}</td>
          <td style="color:var(--text-muted);font-size:.85rem">Archived ${archivedOn}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-primary btn-icon" onclick="restoreGenericProduct('${esc(g.id)}')" title="Restore product">
              <i class="fas fa-rotate-left"></i> Restore
            </button>
          </td>
        </tr>
      `;
    }

    return `
      <tr class="product-row" onclick="openEditProduct('${esc(g.id)}')" title="Click to edit">
        <td><strong>${esc(g.name)}</strong></td>
        <td>${g.category ? `<span class="category-badge cat-${slugify(g.category)}">${esc(g.category)}</span>` : '—'}</td>
        <td>${supplierLabel}</td>
        <td>${latestCpu !== null ? fmt(latestCpu) + ' / ' + esc(latestUnit) : '—'}</td>
        <td style="color:var(--text-muted);font-size:.85rem">${lastPurchase}</td>
        <td onclick="event.stopPropagation()" style="white-space:nowrap">
          <button class="btn btn-icon" style="background:#4f46e5;color:#fff" onclick="openGroupProductsModal('${esc(g.id)}')" title="Group with interchangeable products">
            <i class="fas fa-object-group"></i>
          </button>
          <button class="btn btn-icon" style="background:#6b7280;color:#fff" onclick="openMergeModal('${esc(g.id)}')" title="Merge into another product">
            <i class="fas fa-code-merge"></i>
          </button>
          <button class="btn btn-danger btn-icon" onclick="deleteGenericProduct('${esc(g.id)}')" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Pagination
  pagi.innerHTML = '';
  for (let i = 1; i <= pages; i++) {
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (i === currentPage ? ' active' : '');
    btn.textContent = i;
    btn.onclick = () => { currentPage = i; renderProductTable(); };
    pagi.appendChild(btn);
  }
}

function renderStats() {
  const el   = document.getElementById('productStats');
  const activeGeneric = allGeneric.filter(g => !g.deleted_at);
  const total = activeGeneric.length;
  // Built-in taxonomy + any custom categories currently in use (chips with a
  // zero count are skipped when rendered, so listing them all is harmless).
  const cats  = mergeCategories(activeGeneric.map(g => g.category));
  const catCounts = cats.map(c => ({ label: c, count: activeGeneric.filter(g => g.category === c).length }));
  const uncat = activeGeneric.filter(g => !g.category).length;

  // Expiry from entries — only entries whose parent product is still active
  const activeIds = new Set(activeGeneric.map(g => g.id));
  const activeEntries = allEntries.filter(e => activeIds.has(e.generic_product_id));
  const today = new Date(); today.setHours(0,0,0,0);
  const expiring = activeEntries.filter(e => {
    if (!e.expiry_date) return false;
    const d = new Date(e.expiry_date); if (isNaN(d)) return false;
    const days = Math.floor((d - today) / 86400000);
    return days >= 0 && days <= 30;
  }).length;
  const expired = activeEntries.filter(e => {
    if (!e.expiry_date) return false;
    const d = new Date(e.expiry_date); if (isNaN(d)) return false;
    return Math.floor((d - today) / 86400000) < 0;
  }).length;

  const allActive = categoryFilter === null;
  el.innerHTML = `
    <div class="stat-chip${allActive ? ' stat-chip-selected' : ''}" style="cursor:pointer" onclick="setCategoryFilter(null)" title="Show all products">
      <i class="fas fa-boxes"></i> ${total} Products
    </div>
    ${catCounts.map(c => {
      if (c.count === 0) return '';
      const isActive = categoryFilter === c.label;
      return `<div class="stat-chip cat-chip cat-${slugify(c.label)}${isActive ? ' cat-chip-active' : ''}" style="cursor:pointer" onclick="setCategoryFilter('${c.label.replace(/'/g, "\\'")}')" title="Filter by ${esc(c.label)}">
        <i class="fas fa-tag"></i> ${c.count} ${esc(c.label)}
      </div>`;
    }).join('')}
    ${uncat > 0 ? `<div class="stat-chip" style="background:#f1f5f9;color:#64748b"><i class="fas fa-question-circle"></i> ${uncat} Uncategorised</div>` : ''}
    ${expiring > 0 ? `<div class="stat-chip" style="background:#fef9c3;color:#854d0e"><i class="fas fa-clock"></i> ${expiring} Expiring soon</div>` : ''}
    ${expired  > 0 ? `<div class="stat-chip" style="background:#fee2e2;color:#991b1b"><i class="fas fa-skull-crossbones"></i> ${expired} Expired</div>` : ''}
  `;
}

// ── Add/Edit Generic Product Modal ─────────────────────────────
async function openAddProductModal() {
  currentGenericId = null;
  _entrySnapshots = null;
  document.getElementById('modalTitle').textContent = 'Add Product';
  document.getElementById('saveProductBtn').innerHTML = '<i class="fas fa-save"></i> Save Product';
  document.getElementById('editProductId').value = '';
  document.getElementById('pName').value        = '';
  refreshCategoryDropdown('');
  document.getElementById('pSubUnitName').value = '';
  document.getElementById('pSubUnitQty').value  = '';
  document.getElementById('pAvgWeight').value   = '';
  document.getElementById('pStockUnit').value   = 'lb';
  document.getElementById('pMidName').value     = '';
  document.getElementById('pMidLb').value       = '';
  document.getElementById('pTopName').value     = '';
  document.getElementById('pTopLb').value       = '';
  updatePackPreview();
  document.getElementById('pReorderLevel').value = '';
  syncReorderUnit();   // unit mirrors the Pack Size unit
  renderAliases(null);          // no product yet — prompt to save first

  // Show entry form immediately — user fills everything on one screen
  document.getElementById('openAddEntryBtn').style.display = 'none';
  document.getElementById('entriesPlaceholder').style.display = 'none';
  document.getElementById('entriesTableScroll').classList.add('hidden');
  document.getElementById('editEntryId').value   = '';
  document.getElementById('eVendorName').value   = '';
  document.getElementById('eSku').value          = '';
  document.getElementById('ePackQty').value      = '';
  document.getElementById('eQtyOrdered').value   = '';
  document.getElementById('eCost').value         = '';
  document.getElementById('ePurchaseDate').value = '';
  document.getElementById('eExpiry').value       = '';
  document.getElementById('eInvoiceRef').value   = '';
  document.getElementById('entryForm').classList.remove('hidden');

  await loadSupplierDropdown();
  updateStockUnitVisibility();   // new product: hidden, unit follows the first entry's pack unit
  openModal('productModal');
}

async function openEditProduct(id) {
  const g = allGeneric.find(x => x.id === id);
  if (!g) return;
  currentGenericId = id;
  _captureEntrySnapshots(id);

  // ── Fill product fields ─────────────────────────────────────
  document.getElementById('modalTitle').textContent = 'Edit Product';
  document.getElementById('saveProductBtn').innerHTML = '<i class="fas fa-save"></i> Save Changes';
  document.getElementById('editProductId').value    = id;
  document.getElementById('pName').value            = g.name         || '';
  refreshCategoryDropdown(g.category || '');
  document.getElementById('pSubUnitName').value     = g.sub_unit_name        || '';
  document.getElementById('pSubUnitQty').value      = g.sub_unit_qty         || '';
  document.getElementById('pAvgWeight').value       = g.avg_weight_per_unit  != null ? g.avg_weight_per_unit : '';
  // base_unit is the declared stocking unit (migration 0032 widened it from the
  // pack-levels-only base). Fall back to the newest entry's pack unit for any
  // product the backfill couldn't derive one for.
  document.getElementById('pStockUnit').value       = g.base_unit            || _inferStockUnit(g) || 'lb';
  document.getElementById('pMidName').value         = g.mid_name             || '';
  document.getElementById('pMidLb').value           = g.mid_lb               != null ? g.mid_lb : '';
  document.getElementById('pTopName').value         = g.top_name             || '';
  document.getElementById('pTopLb').value           = g.top_lb               != null ? g.top_lb : '';
  updatePackPreview();
  document.getElementById('pReorderLevel').value    = g.reorder_level        != null ? g.reorder_level : '';
  // pReorderUnit mirrors the declared stocking unit via syncReorderUnit(),
  // already called by the updatePackPreview() above.

  await loadSupplierDropdown();
  await renderAliases(id);

  // ── Pre-fill entry form with most recent entry ──────────────
  const entries = allEntries
    .filter(e => e.generic_product_id === id)
    .sort((a, b) => (b.purchase_date || b.created_at || '') > (a.purchase_date || a.created_at || '') ? 1 : -1);

  const latest = entries[0] || null;

  if (latest) {
    // Fill entry form with the most recent purchase entry
    document.getElementById('editEntryId').value    = latest.id;
    document.getElementById('eSupplier').value      = latest.supplier_id      || '';
    document.getElementById('eVendorName').value    = latest.vendor_item_name || '';
    document.getElementById('eSku').value           = latest.sku              || '';
    document.getElementById('ePackQty').value       = latest.pack_qty         || '';
    document.getElementById('eQtyOrdered').value    = latest.qty_ordered      || '';
    setSelectValueCI(document.getElementById('ePackUnit'), latest.pack_unit || 'kg');
    document.getElementById('ePackUnit').dataset.prevUnit = document.getElementById('ePackUnit').value || 'kg';
    // eCost holds the line total from the invoice; per-unit price is derived below.
    document.getElementById('eCost').value          = (parseFloat(latest.cost) > 0 ? parseFloat(latest.cost) : '');
    document.getElementById('ePurchaseDate').value  = latest.purchase_date    || '';
    document.getElementById('eExpiry').value        = latest.expiry_date      || '';
    document.getElementById('eInvoiceRef').value    = invoiceNumber(latest.invoice_id) || latest.invoice_ref || '';
    updateEntryCostPerUnit();
    document.getElementById('entriesPlaceholder').style.display = 'none';
  } else {
    // No entries yet — show blank entry form
    document.getElementById('editEntryId').value    = '';
    document.getElementById('eSupplier').value      = '';
    document.getElementById('eVendorName').value    = '';
    document.getElementById('eSku').value           = '';
    document.getElementById('ePackQty').value       = '';
    document.getElementById('eQtyOrdered').value    = '';
    setSelectValueCI(document.getElementById('ePackUnit'), 'kg');
    document.getElementById('ePackUnit').dataset.prevUnit = 'kg';
    document.getElementById('eCost').value          = '';
    document.getElementById('ePurchaseDate').value  = '';
    document.getElementById('eExpiry').value        = '';
    document.getElementById('eInvoiceRef').value    = '';
    updateEntryCostPerUnit();
    document.getElementById('entriesPlaceholder').style.display = 'none';
  }

  // Always show the entry form and Add button, always show existing entries table
  document.getElementById('entryForm').classList.remove('hidden');
  document.getElementById('openAddEntryBtn').style.display = entries.length ? '' : 'none';
  _entriesShownCount = 10;
  renderEntriesTable(id);
  updateStockUnitVisibility();   // show the picker only if suppliers disagree on units
  openModal('productModal');
}

async function saveGenericProduct() {
  const id       = document.getElementById('editProductId').value;
  const name     = document.getElementById('pName').value.trim();
  const category = document.getElementById('pCategory').value;
  if (!name)     { showToast('Product name is required.', 'error'); return; }
  if (!category) { showToast('Please select a category.', 'error'); return; }

  // Check if entry fields are filled
  const supplierId   = document.getElementById('eSupplier').value;
  const packQtyVal   = document.getElementById('ePackQty').value.trim();
  const costVal      = document.getElementById('eCost').value.trim();
  const entryHasData = supplierId || packQtyVal || costVal;

  // If entry form has data, validate it before saving anything
  if (entryHasData) {
    if (!supplierId)                                              { showToast('Please select a vendor.', 'error'); return; }
    if (!packQtyVal || isNaN(parseFloat(packQtyVal)) || parseFloat(packQtyVal) <= 0)
                                                                  { showToast('Enter a valid pack size.', 'error'); return; }
    if (isNaN(parseFloat(costVal)) || parseFloat(costVal) < 0)   { showToast('Enter a valid cost.', 'error'); return; }
  }

  const avgWeightRaw = parseFloat(document.getElementById('pAvgWeight').value);
  const newUnit      = (document.getElementById('pStockUnit').value || '').trim().toLowerCase();
  let   reorderRaw   = parseFloat(document.getElementById('pReorderLevel').value);

  // If the stocking unit changed, the reorder threshold (stored as a bare number
  // in the old unit) must convert too, or the low-stock alert compares mismatched
  // units. Only convert when the user left the prefilled number untouched — if
  // they retyped it they're thinking in the new unit already (the field's label
  // follows the new unit). g is the pre-save product (null for new products).
  const gPrev = id ? allGeneric.find(x => x.id === id) : null;
  if (gPrev && !isNaN(reorderRaw) && gPrev.reorder_level != null
      && parseFloat(gPrev.reorder_level) === reorderRaw
      && gPrev.reorder_unit && newUnit && !_sameUnit(gPrev.reorder_unit, newUnit)) {
    const rc = _convertQuantity(reorderRaw, gPrev.reorder_unit, newUnit, isNaN(avgWeightRaw) ? null : avgWeightRaw);
    if (!rc.error) reorderRaw = Math.round(rc.qty * 1e6) / 1e6;
  }

  // ── Pack sizes (multi-level counting) ──────────────────────────
  // A pack level is "set" when its weight is a positive number; the name is a
  // display label. Pack weights are expressed in the declared stocking unit.
  const midName = document.getElementById('pMidName').value.trim();
  const topName = document.getElementById('pTopName').value.trim();
  const midLb   = parseFloat(document.getElementById('pMidLb').value);
  const topLb   = parseFloat(document.getElementById('pTopLb').value);
  // The declared stocking unit — what this item is counted and priced in, and
  // what every purchase converts into. Always stored (migration 0032): pack
  // levels stay gated on mid_lb/top_lb, so a populated base_unit does NOT turn
  // pack-level entry on. See pkConfigFrom() in utils.js.
  const baseUnit = (document.getElementById('pStockUnit').value || 'lb').trim().toLowerCase();
  const hasMid  = !isNaN(midLb) && midLb > 0;
  const hasTop  = !isNaN(topLb) && topLb > 0;

  if ((!isNaN(midLb) && midLb <= 0) || (!isNaN(topLb) && topLb <= 0)) {
    showToast('Pack weights must be greater than zero.', 'error'); return;
  }
  if (hasTop && hasMid && topLb <= midLb) {
    showToast(`The top pack (${topName || 'case'}) must weigh more than the middle pack (${midName || 'bag'}).`, 'error'); return;
  }

  const payload = {
    name,
    category,
    sub_unit_name:        document.getElementById('pSubUnitName').value.trim() || null,
    sub_unit_qty:         parseFloat(document.getElementById('pSubUnitQty').value) || null,
    avg_weight_per_unit:  isNaN(avgWeightRaw) ? null : avgWeightRaw,
    base_unit:            baseUnit,
    mid_name:             hasMid ? (midName || 'bag')  : '',
    mid_lb:               hasMid ? midLb : null,
    top_name:             hasTop ? (topName || 'case') : '',
    top_lb:               hasTop ? topLb : null,
    reorder_level:        isNaN(reorderRaw) ? null : reorderRaw,
    // Mirrors the declared stocking unit (shown in the read-only pReorderUnit
    // field), so the threshold is compared against the bin in the same unit.
    reorder_unit:         isNaN(reorderRaw) ? '' : newUnit,
  };

  const btn = document.getElementById('saveProductBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    let savedId = id;
    if (id) {
      // ── Edit existing generic product ──
      // Dedicated endpoint cascades a name change to invoice lines, entries,
      // mappings, inventory and recipe links so nothing goes stale.
      await apiPut(`${GENERIC_TABLE}/${id}`, payload);
    } else {
      // ── Create new generic product ──
      const created = await apiPost(`tables/${GENERIC_TABLE}`, payload);
      savedId = created.id;
      currentGenericId = savedId;
      document.getElementById('editProductId').value = savedId;
      // The product now exists, so vendor names can be attached to it.
      await renderAliases(savedId);
    }

    // Persist any pending unit conversions to DB before saving the entry
    const entryId = document.getElementById('editEntryId').value;
    await _flushEntryConversions(savedId, entryId);

    // The stocking unit is now a field of its own, so it can change without any
    // entry being touched. Whenever it actually moved, bring the on-hand bin
    // into the new unit — otherwise the quantity keeps meaning the old unit.
    const stockUnitChanged = gPrev && gPrev.base_unit && !_sameUnit(gPrev.base_unit, baseUnit);
    if (stockUnitChanged) await _reconcileInventoryUnit(savedId, baseUnit);

    if (entryHasData || entryId) {
      // _saveEntryForGeneric handles toast + inventory prompt; returns true on success
      const ok = await _saveEntryForGeneric(savedId, name, category);
      if (ok) {
        // Editing an existing entry may also have changed its pack unit; the bin
        // is authoritative in the declared stocking unit either way.
        if (entryId && !stockUnitChanged) await _reconcileInventoryUnit(savedId, baseUnit);
        closeModal('productModal');
      }
    } else {
      showToast(id ? 'Product updated!' : 'Product saved!', 'success');
      closeModal('productModal');
    }

    await loadAll();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save Product';
  }
}

async function deleteGenericProduct(id) {
  if (!confirm(
    'Delete this product? It will be removed from your active products and current inventory.\n\n' +
    'Its purchase history and stock-movement log are kept for your records.'
  )) return;
  try {
    // Archive (soft delete): the backend sets deleted_at and clears live state
    // (inventory, aliases) while preserving entries, recipe links and stock_log.
    // Entries are intentionally NOT deleted here — they're historical records.
    await apiDelete(`tables/${GENERIC_TABLE}/${id}`);
    showToast('Product deleted — history kept.', 'warning');
    await loadAll();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

// ── Archived view ──────────────────────────────────────────────
// Toggle between the active product list and the archived (soft-deleted) list.
function toggleArchivedView() {
  showArchived = document.getElementById('toggleArchivedInput').checked;
  currentPage  = 1;
  categoryFilter = null; // category tabs count actives; don't carry the filter across
  // Hide "Add Product" while browsing the archive — it's not the place to add.
  document.getElementById('openAddProductModal').style.display = showArchived ? 'none' : '';
  renderStats();
  renderProductTable();
}

// Restore a soft-deleted product: clear deleted_at so it returns to active lists.
// Inventory and aliases were cleared at archive time and are NOT restored — the
// product comes back with its purchase history but no live stock (run a stock
// take if needed).
async function restoreGenericProduct(id) {
  const g = allGeneric.find(x => x.id === id);
  if (!confirm(`Restore "${g ? g.name : 'this product'}" to your active products?\n\nIts purchase history returns. Stock levels are not restored — do a stock take if needed.`)) return;
  try {
    await apiPatch(`tables/${GENERIC_TABLE}/${id}`, { deleted_at: null });
    if (g) g.deleted_at = null;
    showToast('Product restored.', 'success');
    renderStats();
    renderProductTable();
  } catch (e) {
    showToast('Restore failed: ' + e.message, 'error');
  }
}

// ── Supplier entries table (inside modal) ──────────────────────
function renderEntriesTable(genericId) {
  const allSorted = allEntries.filter(e => e.generic_product_id === genericId)
    .slice().sort((a, b) => (b.purchase_date || b.created_at || '') > (a.purchase_date || a.created_at || '') ? 1 : -1); // newest first

  const scroll = document.getElementById('entriesTableScroll');
  const tbody  = document.getElementById('entriesBody');
  const smEl   = document.getElementById('entriesShowMore');

  if (!allSorted.length) {
    scroll.classList.add('hidden');
    if (smEl) smEl.style.display = 'none';
    return;
  }
  scroll.classList.remove('hidden');

  // latestCpu = most recent entry (first in newest-first order)
  const latestCpu = allSorted[0]
    ? ((allSorted[0].cost_per_unit != null && allSorted[0].cost_per_unit > 0)
        ? allSorted[0].cost_per_unit
        : (entryPackQty(allSorted[0]) > 0 ? allSorted[0].cost / entryPackQty(allSorted[0]) : allSorted[0].cost))
    : null;

  const visible = allSorted.slice(0, _entriesShownCount);

  tbody.innerHTML = visible.map(e => {
    const cpu      = (e.cost_per_unit != null && e.cost_per_unit > 0)
      ? e.cost_per_unit
      : (entryPackQty(e) > 0 ? e.cost / entryPackQty(e) : e.cost);
    const variance  = latestCpu && latestCpu > 0 ? ((cpu - latestCpu) / latestCpu * 100) : 0;
    const varClass  = variance > 0 ? 'color:#dc2626' : variance < 0 ? 'color:#16a34a' : 'color:var(--text-muted)';
    const varText   = variance === 0 ? '0.0%' : (variance > 0 ? '+' : '') + variance.toFixed(1) + '%';
    const daysLeft  = e.expiry_date ? Math.floor((new Date(e.expiry_date) - new Date().setHours(0,0,0,0)) / 86400000) : null;

    return `
      <tr>
        <td><strong>${esc(e.supplier_name || '—')}</strong></td>
        <td>${esc(e.vendor_item_name || '—')}</td>
        <td>${e.pack_qty ? esc(e.pack_qty + ' ' + (e.pack_unit || '')) : '—'}</td>
        <td>${fmt(e.cost)}</td>
        <td><strong>${fmt(cpu)} / ${esc(entryPackUnit(e))}</strong></td>
        <td style="font-size:.8rem">${fmtDate(e.purchase_date)}</td>
        <td style="font-size:.8rem">${e.expiry_date ? daysBadge(daysLeft) : '—'}</td>
        <td style="font-size:.8rem">
          ${e.invoice_id
            ? `<a href="/invoices.html#${esc(e.invoice_id)}" title="View invoice" style="color:var(--primary);font-weight:500;text-decoration:none">${esc(invoiceNumber(e.invoice_id) || 'N/A')}</a>`
            : (e.invoice_ref ? 'N/A' : '—')}
          ${e.invoice_file_key
            ? `<button class="btn btn-primary btn-icon" style="padding:.15rem .35rem;font-size:.72rem;margin-left:.3rem"
                onclick="viewEntryInvoiceFile('${esc(e.invoice_file_key)}','${esc(e.invoice_file_name||e.invoice_ref||'Invoice')}')"
                title="View attached invoice"><i class="fas fa-eye"></i></button>`
            : ''}
        </td>
        <td style="font-weight:600;font-size:.82rem;${varClass}">${varText}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-primary btn-icon" onclick="openEditEntryForm('${esc(e.id)}')" title="Edit"><i class="fas fa-pen"></i></button>
          <button class="btn btn-danger btn-icon" onclick="deleteEntry('${esc(e.id)}')" title="Delete"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `;
  }).join('');

  // Show more button
  if (smEl) {
    const remaining = allSorted.length - _entriesShownCount;
    if (remaining > 0) {
      smEl.style.display = '';
      smEl.querySelector('button').innerHTML =
        `<i class="fas fa-chevron-down"></i> Show more (${remaining} older ${remaining === 1 ? 'entry' : 'entries'})`;
    } else {
      smEl.style.display = 'none';
    }
  }
}

function showMoreEntries() {
  _entriesShownCount += 10;
  renderEntriesTable(currentGenericId);
}
window.showMoreEntries = showMoreEntries;

// ── Entry form (inline in modal) ───────────────────────────────
async function loadSupplierDropdown() {
  try {
    const data = await apiGet(`tables/suppliers?page=1&limit=500`);
    allSupplierList = data.data || [];
  } catch (_) {}
  const sel = document.getElementById('eSupplier');
  sel.innerHTML = '<option value="">— Select vendor —</option>' +
    allSupplierList.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
}

// ── Vendor names (product_aliases) ─────────────────────────────
// An alias maps a supplier's wording to this product, so an invoice line like
// "Grape Tomatoes" links here instead of creating a duplicate. supplier_id ''
// / null means "accept this name from any vendor"; a supplier-specific alias
// takes precedence at import time (see /api/bulk/upsert-products).

let _aliasesForProduct = [];

async function renderAliases(genericId) {
  const wrap      = document.getElementById('aliasWrap');
  const saveFirst = document.getElementById('aliasSaveFirst');
  const listEl    = document.getElementById('aliasList');

  // Aliases point at a product id, so there's nothing to attach them to until
  // the product exists.
  if (!genericId) {
    _aliasesForProduct = [];
    wrap.style.display      = 'none';
    saveFirst.style.display = '';
    return;
  }
  wrap.style.display      = '';
  saveFirst.style.display = 'none';

  try {
    const data = await apiGet(`tables/product_aliases?generic_product_id=${encodeURIComponent(genericId)}`);
    _aliasesForProduct = data.data || [];
  } catch (_) {
    _aliasesForProduct = [];
  }

  if (!_aliasesForProduct.length) {
    listEl.innerHTML = `<div style="font-size:.82rem;color:var(--text-muted)">No other supplier names yet — they'll appear here as you approve invoices.</div>`;
    return;
  }

  listEl.innerHTML = _aliasesForProduct.map(a => {
    const sup = a.supplier_id
      ? (allSupplierList.find(s => s.id === a.supplier_id)?.name || 'Unknown vendor')
      : 'Any vendor';
    return `
      <div style="display:flex;align-items:center;gap:.5rem;padding:.35rem .6rem;background:#f8fafc;border:1px solid var(--border);border-radius:6px;margin-bottom:.35rem">
        <span style="font-weight:600;font-size:.86rem">${esc(a.alias_name)}</span>
        <span style="font-size:.76rem;color:var(--text-muted)">from ${esc(sup)}</span>
        <button class="btn btn-icon btn-sm" style="margin-left:auto;background:#fee2e2;color:#dc2626"
                title="Remove this vendor name" onclick="deleteAlias('${esc(a.id)}')">
          <i class="fas fa-times"></i>
        </button>
      </div>`;
  }).join('');
}

async function deleteAlias(id) {
  // Removing an alias only stops future invoices auto-linking by that name —
  // purchases already filed against the product are untouched.
  if (!confirm('Remove this vendor name? Past purchases stay linked to this product.')) return;
  try {
    await apiDelete(`tables/product_aliases/${id}`);
    await renderAliases(document.getElementById('editProductId').value);
    showToast('Vendor name removed.', 'success');
  } catch (e) {
    showToast('Could not remove: ' + e.message, 'error');
  }
}

window.deleteAlias = deleteAlias;

function openAddEntryForm() {
  document.getElementById('editEntryId').value    = '';
  document.getElementById('eSupplier').value      = '';
  document.getElementById('eVendorName').value    = '';
  document.getElementById('eSku').value           = '';
  document.getElementById('ePackQty').value       = '';
  document.getElementById('eQtyOrdered').value    = '';
  setSelectValueCI(document.getElementById('ePackUnit'), 'kg');
  document.getElementById('ePackUnit').dataset.prevUnit = 'kg';
  document.getElementById('eCost').value          = '';
  document.getElementById('ePurchaseDate').value  = new Date().toISOString().split('T')[0];
  document.getElementById('eExpiry').value        = '';
  document.getElementById('eInvoiceRef').value    = '';
  clearEntryInvoiceFile();   // reset any previously attached file
  updateEntryCostPerUnit();
  document.getElementById('entryForm').classList.remove('hidden');
  document.getElementById('entryForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openEditEntryForm(entryId) {
  const e = allEntries.find(x => x.id === entryId);
  if (!e) return;
  document.getElementById('editEntryId').value   = entryId;
  document.getElementById('eSupplier').value     = e.supplier_id      || '';
  document.getElementById('eVendorName').value   = e.vendor_item_name || '';
  document.getElementById('eSku').value          = e.sku              || '';
  document.getElementById('ePurchaseDate').value = e.purchase_date    || '';
  document.getElementById('eExpiry').value       = e.expiry_date      || '';
  document.getElementById('eInvoiceRef').value   = invoiceNumber(e.invoice_id) || e.invoice_ref || '';
  // eCost holds the line total from the invoice; per-unit price is derived below.
  document.getElementById('eCost').value         = (parseFloat(e.cost) > 0 ? parseFloat(e.cost) : '');
  // Populate pack qty + unit directly from columns
  document.getElementById('ePackQty').value      = e.pack_qty    || '';
  document.getElementById('eQtyOrdered').value   = e.qty_ordered || '';
  setSelectValueCI(document.getElementById('ePackUnit'), e.pack_unit || 'kg');
  document.getElementById('ePackUnit').dataset.prevUnit = document.getElementById('ePackUnit').value || 'kg';
  // Restore attached invoice file (if any)
  if (e.invoice_file_key) {
    setEntryInvoiceFileBadge(e.invoice_file_name || e.invoice_file_key, e.invoice_file_key);
  } else {
    clearEntryInvoiceFile();
  }
  updateEntryCostPerUnit();
  document.getElementById('entryForm').classList.remove('hidden');
  document.getElementById('entryForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeEntryForm() {
  document.getElementById('entryForm').classList.add('hidden');
}

function updateEntryCostPerUnit() {
  const cost       = parseFloat(document.getElementById('eCost').value);
  const packQty    = parseFloat(document.getElementById('ePackQty').value);
  const qtyOrdered = parseFloat(document.getElementById('eQtyOrdered').value) || 1;
  const unit       = document.getElementById('ePackUnit').value;
  const box        = document.getElementById('eCostPerUnitBox');
  const display    = document.getElementById('eCostPerUnitDisplay');
  const totalEl    = document.getElementById('ePackTotal');

  // Update Total display
  if (!isNaN(packQty) && packQty > 0) {
    const tot = packQty * qtyOrdered;
    totalEl.textContent = `${Number.isInteger(tot) ? tot : parseFloat(tot.toFixed(4))} ${unit}`;
  } else {
    totalEl.textContent = '—';
  }

  box.classList.remove('ready', 'error');
  if (isNaN(cost) || isNaN(packQty) || packQty <= 0) {
    display.textContent = 'Enter cost & pack size';
    return;
  }
  const totalUnits = packQty * qtyOrdered;
  box.classList.add('ready');
  display.textContent = `${fmt(cost / totalUnits)} / ${unit}`;

  syncReorderUnit();
}

// The low-stock threshold is expressed in the product's supplier-entry unit of
// measure, so its unit display mirrors the Pack Size unit and updates live when
// that unit changes. Read-only in the form; the value is derived, not typed.
// The low-stock threshold is compared against the inventory bin, which is now
// kept in the declared stocking unit — so the threshold's unit follows that,
// not whichever unit the currently-selected supplier happens to invoice in.
function syncReorderUnit() {
  const src = document.getElementById('pStockUnit');
  const dst = document.getElementById('pReorderUnit');
  if (src && dst) dst.value = src.value || '';
}

// Keep the Pack Sizes section's echoed labels and the plain-language preview in
// sync as the user types. Base is always a weight; middle/top are optional packs
// whose weight (in the base unit) is what wires them into stock takes.
function updatePackPreview() {
  const base    = (document.getElementById('pStockUnit').value || 'lb').trim();
  document.getElementById('pBaseUnitEcho').value = base;
  const midName = document.getElementById('pMidName').value.trim();
  const topName = document.getElementById('pTopName').value.trim();
  const midLb   = parseFloat(document.getElementById('pMidLb').value);
  const topLb   = parseFloat(document.getElementById('pTopLb').value);
  const hasMid  = !isNaN(midLb) && midLb > 0;
  const hasTop  = !isNaN(topLb) && topLb > 0;

  syncReorderUnit();   // threshold unit follows the stocking unit

  // Reactive labels next to the weight inputs
  document.getElementById('pMidNameEcho').textContent = midName || 'middle pack';
  document.getElementById('pTopNameEcho').textContent = topName || 'top pack';
  document.getElementById('pMidUnitEcho').textContent = base;
  document.getElementById('pTopUnitEcho').textContent = base;

  const preview = document.getElementById('pPackPreview');
  const parts = [];
  if (hasTop) parts.push(`1 ${topName || 'case'} = ${fmtNum(topLb)} ${base}`);
  if (hasMid) parts.push(`1 ${midName || 'bag'} = ${fmtNum(midLb)} ${base}`);
  if (hasTop && hasMid) {
    const per = topLb / midLb;
    parts.push(`so 1 ${topName || 'case'} ≈ ${fmtNum(Math.round(per * 100) / 100)} ${midName || 'bag'}`);
  }
  if (parts.length) {
    preview.innerHTML = `<i class="fas fa-circle-info"></i> ${parts.map(esc).join(' &nbsp;·&nbsp; ')}`;
    preview.style.display = '';
  } else {
    preview.style.display = 'none';
  }
}

// Trim trailing zeros for tidy display (2.50 -> 2.5, 5.00 -> 5)
function fmtNum(n) {
  if (n == null || isNaN(n)) return '';
  return (Math.round(n * 1000) / 1000).toString();
}

// ── Unit conversion for ePackUnit dropdown ─────────────────────
// Convertible units, matched case-insensitively. `factor` = amount of the
// dimension's base unit (weight base = kg, volume base = L) in one of this unit.
// Units NOT listed here (Each, Case, Pack, Can, Dozen, …) are non-convertible.
const _UNIT_FACTORS = {
  kg:  { dim: 'weight', factor: 1 },
  g:   { dim: 'weight', factor: 0.001 },
  lb:  { dim: 'weight', factor: 0.45359237 },
  lbs: { dim: 'weight', factor: 0.45359237 },
  oz:  { dim: 'weight', factor: 0.0283495231 },
  l:   { dim: 'volume', factor: 1 },
  ml:  { dim: 'volume', factor: 0.001 },
  gal: { dim: 'volume', factor: 3.78541178 },
};

// Look up a unit's dimension + base factor, case- and whitespace-insensitive.
function _unitInfo(unit) {
  return _UNIT_FACTORS[String(unit || '').trim().toLowerCase()] || null;
}

function _sameUnit(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

// Best guess at a product's stocking unit when base_unit is blank — the newest
// supplier entry's pack unit. Only a prefill for the picker: migration 0032
// backfilled base_unit for everything that had stock or purchase history, so
// this covers products created since, or never purchased.
function _inferStockUnit(g) {
  if (!g || !g.id) return '';
  const newest = allEntries
    .filter(e => e.generic_product_id === g.id && !e.voided_at && String(e.pack_unit || '').trim())
    .sort((a, b) => String(b.purchase_date || '').localeCompare(String(a.purchase_date || '')))[0];
  return newest ? String(newest.pack_unit).trim().toLowerCase() : '';
}

// Which stocking units are actually in use across a product's live entries, and
// which suppliers bill in each. Map<unit, Set<vendor>>. More than one key is the
// mixed-unit case (Yen kg vs Neptune lb) where the app can't pick a stocking
// unit on its own — that's the only time we surface the "Stocked In" picker.
function _stockUnitUsage(productId) {
  const byUnit = new Map();
  if (!productId) return byUnit;
  allEntries
    .filter(e => e.generic_product_id === productId && !e.voided_at && String(e.pack_unit || '').trim())
    .forEach(e => {
      const u = String(e.pack_unit).trim().toLowerCase();
      if (!byUnit.has(u)) byUnit.set(u, new Set());
      const v = (e.supplier_name || '').trim();
      if (v) byUnit.get(u).add(v);
    });
  return byUnit;
}

// Show the "Stocked In" picker only when suppliers disagree on the unit; when
// they agree (or there are no saved entries yet) the unit is derived silently
// and the section is hidden. This keeps the mixed-unit safety — a declared
// stocking unit everything converts into — without asking on every product.
function updateStockUnitVisibility() {
  const productId = document.getElementById('editProductId').value;
  const section   = document.getElementById('stockUnitSection');
  const note      = document.getElementById('stockUnitConflictNote');
  const sel       = document.getElementById('pStockUnit');
  if (!section || !sel) return;

  const usage = _stockUnitUsage(productId);
  const units = [...usage.keys()];

  if (units.length >= 2) {
    // Conflict — the user must choose. Leave whatever unit is selected (their
    // declared base_unit, if any) and explain the clash in plain language.
    section.style.display = '';
    const parts = units.map(u => {
      const vendors = [...usage.get(u)];
      return vendors.length
        ? `${vendors.join(', ')} bill${vendors.length === 1 ? 's' : ''} in ${u}`
        : `some suppliers bill in ${u}`;
    });
    note.style.display = '';
    note.innerHTML = `<i class="fas fa-triangle-exclamation"></i> ${esc(parts.join('; '))} — pick the unit you count and price this item in.`;
    return;
  }

  // No conflict — hide the section. For an existing product the selection is
  // already right (openEditProduct set it from the declared/inferred unit), so
  // leave it untouched to avoid a silent unit change + inventory conversion. For
  // a brand-new product the stocking unit follows the first purchase's pack unit.
  section.style.display = 'none';
  note.style.display = 'none';
  if (!productId) {
    const packUnitEl = document.getElementById('ePackUnit');
    if (packUnitEl && packUnitEl.value) setSelectValueCI(sel, packUnitEl.value.trim().toLowerCase());
  }
  updatePackPreview();   // cascades the unit to the pack labels + reorder unit
}

function _isEach(unit) {
  return String(unit || '').trim().toLowerCase() === 'each';
}

// Convert a cost-per-unit-of-measure (e.g. $/lb -> $/kg).
// Returns { cost } on success, or { error } on failure.
// avgWeightPerUnit is in kg (used only for Each -> weight conversions).
function _convertUnitCost(cost, fromUnit, toUnit, avgWeightPerUnit) {
  if (_sameUnit(fromUnit, toUnit)) return { cost };

  const from = _unitInfo(fromUnit);
  const to   = _unitInfo(toUnit);

  // Each -> weight: cost_per_kg = cost_per_each / kg_per_each, then into toUnit.
  if (_isEach(fromUnit) && to && to.dim === 'weight') {
    if (!avgWeightPerUnit || isNaN(avgWeightPerUnit) || avgWeightPerUnit <= 0) {
      return { error: 'Set Average Weight per Unit first to enable conversion' };
    }
    const costPerKg = cost / avgWeightPerUnit;
    return { cost: costPerKg * to.factor };
  }

  // Same dimension (weight<->weight or volume<->volume): cost_B = cost_A × factor_B/factor_A.
  if (from && to && from.dim === to.dim) {
    return { cost: cost * (to.factor / from.factor) };
  }

  return { error: `Cannot convert ${fromUnit} to ${toUnit}` };
}

// Convert a physical quantity (e.g. 35 lb -> 15.876 kg) — the reciprocal of the
// cost conversion above. Returns { qty } on success, or { error } on failure.
// Delegates to the shared converter in utils.js so quantity conversion has ONE
// implementation across pages (see memory: unit-of-measure-cascade).
function _convertQuantity(qty, fromUnit, toUnit, avgWeightPerUnit) {
  return invConvertQty(qty, fromUnit, toUnit, avgWeightPerUnit);
}

async function onPackUnitChange() {
  const select  = document.getElementById('ePackUnit');
  const newUnit = select.value;

  if (newUnit === '__manage_units__') {
    select.value = select.dataset.prevUnit || '';
    openManageUnitsModal();
    return;
  }

  const prevUnit = select.dataset.prevUnit || newUnit;

  // Track the new unit so subsequent changes have the right baseline
  select.dataset.prevUnit = newUnit;

  if (newUnit === prevUnit) { updateEntryCostPerUnit(); return; }

  // Look up avg_weight_per_unit for the current product (Each <-> weight only)
  let avgWeight = null;
  if (currentGenericId) {
    const g = allGeneric.find(x => x.id === currentGenericId);
    if (g) avgWeight = parseFloat(g.avg_weight_per_unit) || null;
  }

  // Pack size is a physical quantity — converting it is what makes the derived
  // per-unit price correct (e.g. 35 lb -> 15.876 kg, so $/kg recomputes right).
  const packQtyEl = document.getElementById('ePackQty');
  const packQty   = parseFloat(packQtyEl.value);
  const hasQty    = !isNaN(packQty) && packQty > 0;

  // Probe convertibility on the quantity (falls back to 1 when no pack size yet).
  const probe = _convertQuantity(hasQty ? packQty : 1, prevUnit, newUnit, avgWeight);

  if (probe.error) {
    // Genuinely incompatible (e.g. kg -> L, or Each without avg weight).
    // Offer to keep the price as-is (just relabel) or revert the dropdown.
    const keepAnyway = await new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:8px;padding:24px 28px;max-width:380px;box-shadow:0 4px 24px rgba(0,0,0,.2)">
          <p style="margin:0 0 20px;font-size:15px;line-height:1.5">Cannot convert <strong>${prevUnit}</strong> to <strong>${newUnit}</strong> automatically. Keep the same price with the new unit?</p>
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button id="_ucc_cancel" style="padding:7px 16px;border:1px solid #ccc;border-radius:5px;background:#fff;cursor:pointer">Cancel</button>
            <button id="_ucc_keep"   style="padding:7px 16px;border:none;border-radius:5px;background:#2563eb;color:#fff;cursor:pointer">Keep anyway</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#_ucc_cancel').onclick = () => { document.body.removeChild(overlay); resolve(false); };
      overlay.querySelector('#_ucc_keep').onclick   = () => { document.body.removeChild(overlay); resolve(true); };
    });

    if (!keepAnyway) {
      select.value = prevUnit;
      select.dataset.prevUnit = prevUnit;
      updateEntryCostPerUnit();
      updateStockUnitVisibility();   // unit reverted — re-check for a conflict
      return;  // reverted — leave other entries alone
    }
    // "Keep anyway" — relabel only; convert whatever sibling entries can convert.
    await _convertAllEntriesToUnit(prevUnit, newUnit);
    updateEntryCostPerUnit();
    updateStockUnitVisibility();   // some entries may still differ → conflict may show
    return;
  }

  // Convertible: rewrite the pack size in the new unit. eCost (invoice line total)
  // stays fixed, so the derived per-unit price recomputes correctly.
  if (hasQty) {
    const converted = Math.round(probe.qty * 1e6) / 1e6;
    packQtyEl.value = Number.isInteger(converted) ? converted : parseFloat(converted.toFixed(6));
  }

  await _convertAllEntriesToUnit(prevUnit, newUnit);
  updateEntryCostPerUnit();
  updateStockUnitVisibility();   // entries now share a unit → section hides; new product follows this unit
}

// Convert cost_per_unit + pack_unit for all sibling entries (not the one in the form).
// Skips entries whose unit can't be converted and shows a warning for them.
async function _convertAllEntriesToUnit(fromUnit, toUnit) {
  if (!currentGenericId || fromUnit === toUnit) return;

  const siblings = allEntries.filter(e =>
    e.generic_product_id === currentGenericId
  );
  if (!siblings.length) return;

  const g = allGeneric.find(x => x.id === currentGenericId);
  const avgWeight = g ? parseFloat(g.avg_weight_per_unit) || null : null;

  const failed = [];

  for (const e of siblings) {
    const entryUnit = e.pack_unit || '';
    if (!entryUnit || entryUnit === toUnit) continue;

    const cpu = parseFloat(e.cost_per_unit);
    if (!cpu || cpu <= 0) {
      e.pack_unit = toUnit;
      continue;
    }

    const result = _convertUnitCost(cpu, entryUnit, toUnit, avgWeight);
    if (result.error) {
      const label = [e.supplier_name, e.purchase_date].filter(Boolean).join(' ') || e.id.slice(0, 8);
      failed.push(label);
      continue;
    }

    e.cost_per_unit = parseFloat(result.cost.toFixed(6));
    e.pack_unit     = toUnit;
  }

  if (failed.length) {
    showToast(
      `Could not convert ${failed.length} entr${failed.length === 1 ? 'y' : 'ies'} (incompatible units): ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`,
      'warning'
    );
  }

  renderEntriesTable(currentGenericId);
}

// Snapshot helpers — keep unit conversions in memory until Save is confirmed

function _captureEntrySnapshots(genericId) {
  _entrySnapshots = new Map();
  for (const e of allEntries) {
    if (e.generic_product_id === genericId) {
      _entrySnapshots.set(e.id, { cost_per_unit: e.cost_per_unit, pack_unit: e.pack_unit });
    }
  }
}

function _restoreEntrySnapshots() {
  if (!_entrySnapshots) return;
  for (const e of allEntries) {
    const snap = _entrySnapshots.get(e.id);
    if (snap) {
      e.cost_per_unit = snap.cost_per_unit;
      e.pack_unit     = snap.pack_unit;
    }
  }
  _entrySnapshots = null;
}

async function _flushEntryConversions(genericId, skipEntryId) {
  if (!_entrySnapshots) return;
  for (const e of allEntries) {
    if (e.generic_product_id !== genericId) continue;
    if (skipEntryId && e.id === skipEntryId) continue; // the form entry is saved separately
    const snap = _entrySnapshots.get(e.id);
    if (!snap) continue;
    if (e.cost_per_unit === snap.cost_per_unit && e.pack_unit === snap.pack_unit) continue;
    await apiPatch(`tables/${ENTRIES_TABLE}/${e.id}`, {
      cost_per_unit: e.cost_per_unit,
      pack_unit:     e.pack_unit,
    });
  }
  _entrySnapshots = null;
}

// When a product's stocking unit changes, its inventory row keeps the OLD unit:
// inventory.unit is copied only when the row is created and is never cascaded.
// That leaves an on-hand quantity whose number still means the old unit sitting
// next to per-new-unit costs — silently corrupting valuation, True COGS and
// low-stock alerts. Reconcile the on-hand inventory to the product's current
// unit: convert the quantity when the units are compatible (logging the
// re-expression for audit), otherwise relabel and warn. Submitted stock takes
// are left as-recorded (a historical count in the unit used at the time).
async function _reconcileInventoryUnit(genericId, newUnit) {
  newUnit = (newUnit || '').trim();
  if (!genericId || !newUnit || !window.invHelpers) return;

  let row;
  try { row = await window.invHelpers.findInvRow(genericId, 'raw_material'); }
  catch (_) { return; }
  if (!row) return;                                    // nothing on hand to reconcile

  const oldUnit = (row.unit || '').trim();
  if (_sameUnit(oldUnit, newUnit)) return;             // already in sync
  if (!oldUnit) {                                       // no prior unit — just label it
    try { await apiPatch(`tables/inventory/${row.id}`, { unit: newUnit }); } catch (_) {}
    return;
  }

  const g      = allGeneric.find(x => x.id === genericId);
  const avgW   = parseFloat(g?.avg_weight_per_unit) || null;
  const oldQty = parseFloat(row.quantity) || 0;
  const conv   = _convertQuantity(oldQty, oldUnit, newUnit, avgW);

  try {
    if (conv.error) {
      // Incompatible (e.g. kg -> L): relabel only — don't fabricate a quantity.
      await apiPatch(`tables/inventory/${row.id}`, { unit: newUnit });
      showToast(`Inventory unit set to ${newUnit}. Couldn't auto-convert the on-hand amount (${oldUnit}→${newUnit}) — please recount.`, 'warning');
    } else {
      const newQty = Math.round(conv.qty * 1e6) / 1e6;
      await apiPatch(`tables/inventory/${row.id}`, { quantity: newQty, unit: newUnit });
      // Audit note (a unit re-expression, not a real physical movement).
      try {
        await window.invHelpers.logStockMove({
          inventory_id: row.id, item_id: genericId, item_type: 'raw_material',
          item_name: row.item_name || g?.name || '',
          change: Math.round((newQty - oldQty) * 1e6) / 1e6,
          reason: `Unit changed ${oldUnit} → ${newUnit} (quantity auto-converted)`,
        });
      } catch (_) {}
      if (oldQty > 0) showToast(`Inventory converted: ${oldQty} ${oldUnit} → ${newQty} ${newUnit}.`, 'success');
    }
  } catch (e) {
    showToast('Could not update inventory unit: ' + e.message, 'error');
  }
}

// Called by the inline "Save Entry" button (editing an existing product)
async function saveEntry() {
  const genericId = document.getElementById('editProductId').value;
  // If no genericId yet (shouldn't happen for edits, but guard anyway)
  if (!genericId) {
    showToast('Please save the product name & category first.', 'error');
    return;
  }
  await _flushEntryConversions(genericId, document.getElementById('editEntryId').value);
  const ok = await _saveEntryForGeneric(genericId, null, null);
  // Reconcile against the declared stocking unit — the bin's unit of record —
  // not the pack unit of whichever supplier entry was just saved.
  if (ok) await _reconcileInventoryUnit(genericId, document.getElementById('pStockUnit').value);
}

// Core entry-save logic — shared by saveGenericProduct (new) and saveEntry (existing)
async function _saveEntryForGeneric(genericId, overrideName, overrideCategory) {
  const entryId    = document.getElementById('editEntryId').value;
  const supplierId = document.getElementById('eSupplier').value;
  const cost       = parseFloat(document.getElementById('eCost').value);
  const packQtyVal = document.getElementById('ePackQty').value.trim();

  if (!supplierId)             { showToast('Please select a vendor.', 'error'); return; }
  if (!packQtyVal || isNaN(parseFloat(packQtyVal)) || parseFloat(packQtyVal) <= 0)
                               { showToast('Enter a valid pack size.', 'error'); return; }
  if (isNaN(cost) || cost < 0) { showToast('Enter a valid cost.', 'error'); return; }

  const g          = allGeneric.find(x => x.id === genericId);
  const gName      = overrideName     || g?.name     || '';
  const gCategory  = overrideCategory || g?.category || 'Other';
  const supplier   = allSupplierList.find(s => s.id === supplierId);
  const expiry      = document.getElementById('eExpiry').value;
  const pQty        = parseFloat(packQtyVal) || 1;
  const qtyOrdered  = parseFloat(document.getElementById('eQtyOrdered').value) || 1;
  const pUnit       = document.getElementById('ePackUnit').value;

  const invFileKey  = document.getElementById('eInvoiceFileKey').value.trim();
  const invFileName = document.getElementById('eInvoiceFileName')?.textContent.trim() || '';

  // If a file is attached, ensure an invoice record exists for it
  let invoiceId = '';
  if (invFileKey) {
    try {
      const invRec = await apiPost('ensure-invoice', {
        file_key:       invFileKey,
        file_name:      invFileName,
        vendor:         supplier?.name || '',
        invoice_number: document.getElementById('eInvoiceRef').value.trim(),
        invoice_date:   document.getElementById('ePurchaseDate').value || '',
        total:          cost,
      });
      invoiceId = invRec.id || '';
    } catch (_) { /* non-fatal — entry still saves without invoice link */ }
  }

  // eCost holds the line total; derive per-unit price as line_total ÷ (pack_qty × qty_ordered).
  const lineTotal  = cost;
  const totalUnits = pQty * qtyOrdered;
  const unitPrice  = totalUnits > 0 ? lineTotal / totalUnits : lineTotal;

  const payload = {
    generic_product_id:   genericId,
    generic_product_name: gName,
    supplier_id:          supplierId,
    supplier_name:        supplier?.name || '',
    vendor_item_name:     document.getElementById('eVendorName').value.trim(),
    sku:                  document.getElementById('eSku').value.trim(),
    pack_qty:             pQty,
    pack_unit:            pUnit,
    qty_ordered:          qtyOrdered,
    cost:                 lineTotal,      // line total  (e.g. 53.28 for 3 × 5 lb at $3.55/lb)
    cost_per_unit:        unitPrice,      // per-unit    (e.g. 3.55)
    purchase_date:        document.getElementById('ePurchaseDate').value,
    expiry_date:          expiry,
    days_left:            daysLeft(expiry),
    invoice_ref:          document.getElementById('eInvoiceRef').value.trim(),
    invoice_file_key:     invFileKey,
    invoice_file_name:    invFileName,
    invoice_id:           invoiceId,
  };

  try {
    if (entryId) {
      await apiPut(`tables/${ENTRIES_TABLE}/${entryId}`, payload);
      showToast('Entry updated!', 'success');
    } else {
      await apiPost(`tables/${ENTRIES_TABLE}`, payload);
      showToast('Product & entry saved!', 'success');
      // Offer to add new stock to Raw Materials inventory
      openEntryInvPrompt({
        genericId,
        itemName:   gName,
        packQty:    pQty,
        packUnit:   pUnit,
        category:   gCategory,
        invoiceRef: document.getElementById('eInvoiceRef').value.trim(),
      });
    }

    closeEntryForm();
    // Show "Add another entry" button now that at least one entry exists
    document.getElementById('openAddEntryBtn').style.display = '';
    document.getElementById('entriesPlaceholder').style.display = 'none';

    // Reload entries cache and re-render table
    const ed = await apiGet(`tables/${ENTRIES_TABLE}?page=1&limit=1000`);
    allEntries = ed.data || [];
    renderEntriesTable(genericId);
    renderProductTable();
    renderStats();
    return true;
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
    return false;
  }
}

async function deleteEntry(entryId) {
  if (!confirm('Delete this supplier entry?')) return;
  try {
    await apiDelete(`tables/${ENTRIES_TABLE}/${entryId}`);
    showToast('Entry deleted.', 'warning');
    const ed = await apiGet(`tables/${ENTRIES_TABLE}?page=1&limit=1000`);
    allEntries = ed.data || [];
    renderEntriesTable(currentGenericId);
    renderProductTable();
    renderStats();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

// ── Pack size helpers for entries ──────────────────────────────
function entryPackQty(e) {
  // Prefer dedicated columns; fall back to parsing legacy pack_size string
  if (e.pack_qty != null && e.pack_qty !== '') return parseFloat(e.pack_qty) || 1;
  const m = (e.pack_size || '').match(/^([\d.]+)/);
  return m ? parseFloat(m[1]) : 1;
}
function entryPackUnit(e) {
  if (e.pack_unit) return e.pack_unit;
  const m = (e.pack_size || '').match(/[\d.]+\s*(.+)$/);
  return m ? m[1].trim() : 'unit';
}

// ── Add-to-Inventory prompt (shown after saving a new supplier entry) ──
function openEntryInvPrompt({ genericId, itemName, packQty, packUnit, category, invoiceRef }) {
  if (!document.getElementById('entryInvModal')) return; // guard

  _pendingEntryInv = { genericId, itemName, packUnit, category, invoiceRef };

  // Show product details
  document.getElementById('entryInvDetails').innerHTML = `
    <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
      <i class="fas fa-box" style="color:#4f46e5"></i>
      <strong>${esc(itemName)}</strong>
      <span style="color:var(--text-muted)">— 1 pack = ${packQty} ${esc(packUnit)}</span>
    </div>
  `;

  // Default quantity = the pack size quantity (1 pack received)
  document.getElementById('entryInvQty').value  = packQty;
  document.getElementById('entryInvUnit').value = packUnit;
  document.getElementById('entryInvNote').value = invoiceRef ? `Invoice: ${invoiceRef}` : '';

  openModal('entryInvModal');
}

async function confirmEntryInventory() {
  if (!_pendingEntryInv) return;
  const qty  = parseFloat(document.getElementById('entryInvQty').value);
  const note = document.getElementById('entryInvNote').value.trim();

  if (isNaN(qty) || qty <= 0) { showToast('Enter a valid quantity.', 'error'); return; }

  const btn = document.getElementById('confirmEntryInvBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding…';

  try {
    if (!window.invHelpers) throw new Error('Inventory module not loaded.');
    const binRow = await window.invHelpers.upsertInventory({
      itemId:    _pendingEntryInv.genericId,
      itemType:  'raw_material',
      itemName:  _pendingEntryInv.itemName,
      category:  _pendingEntryInv.category,
      unit:      _pendingEntryInv.packUnit,
      change:    qty,
      reason:    note || 'Stock-in from product entry',
    });
    // The bin may be kept in a different unit than this supplier invoices in,
    // in which case say what actually landed rather than echoing the input.
    const entered = _pendingEntryInv.packUnit;
    const binUnit = String(binRow?.unit || entered).trim();
    if (_sameUnit(entered, binUnit)) {
      showToast(`${qty} ${entered} of ${_pendingEntryInv.itemName} added to inventory!`, 'success');
    } else {
      const g    = allGeneric.find(x => x.id === _pendingEntryInv.genericId);
      const conv = invConvertQty(qty, entered, binUnit, parseFloat(g?.avg_weight_per_unit) || null);
      const shown = conv.error ? qty : Math.round(conv.qty * 1e6) / 1e6;
      showToast(`${qty} ${entered} of ${_pendingEntryInv.itemName} added as ${shown} ${binUnit}.`, 'success');
    }
    closeModal('entryInvModal');
    _pendingEntryInv = null;
  } catch (e) {
    showToast('Failed to add to inventory: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-warehouse"></i> Add to Inventory';
  }
}

// Reload unit dropdowns after manage-units changes
registerUnitRefreshCallback(async () => {
  if (!document.getElementById('ePackUnit')) return;
  const ud = await apiGet(`tables/units?page=1&limit=100`);
  allUnits = (ud.data || []).slice().sort((a, b) => a.sort_order - b.sort_order);
  populateUnitDropdown(document.getElementById('ePackUnit'));
});

// Reload the category dropdown after manage-categories / inline-add changes
registerCategoryRefreshCallback(async () => {
  if (!document.getElementById('pCategory')) return;
  allCategories = await fetchCategoryNames();
  const sel = document.getElementById('pCategory');
  refreshCategoryDropdown(sel.value);
});

// ══════════════════════════════════════════════════════════════
// ENTRY INVOICE FILE — attach, preview, clear
// ══════════════════════════════════════════════════════════════

// Show file name badge + View button; store key in hidden field
function setEntryInvoiceFileBadge(fileName, fileKey) {
  const badge    = document.getElementById('eInvoiceFileBadge');
  const nameEl   = document.getElementById('eInvoiceFileName');
  const viewBtn  = document.getElementById('eInvoiceViewBtn');
  const fileKey_ = document.getElementById('eInvoiceFileKey');

  if (nameEl)  nameEl.textContent = fileName || fileKey;
  if (fileKey_) fileKey_.value    = fileKey;
  if (badge)   { badge.style.display = 'flex'; badge.style.alignItems = 'center'; badge.style.gap = '.35rem'; }
  if (viewBtn) viewBtn.classList.remove('hidden');

  // Hide spinner, show file icon
  const spinner = document.getElementById('eInvoiceFileSpinner');
  const icon    = document.getElementById('eInvoiceFileIcon');
  if (spinner) spinner.style.display = 'none';
  if (icon)    icon.style.display    = '';
}

// Clear all file attachment UI
function clearEntryInvoiceFile() {
  const badge   = document.getElementById('eInvoiceFileBadge');
  const nameEl  = document.getElementById('eInvoiceFileName');
  const viewBtn = document.getElementById('eInvoiceViewBtn');
  const keyEl   = document.getElementById('eInvoiceFileKey');
  const input   = document.getElementById('eInvoiceFile');

  if (badge)   badge.style.display = 'none';
  if (nameEl)  nameEl.textContent  = '';
  if (viewBtn) viewBtn.classList.add('hidden');
  if (keyEl)   keyEl.value         = '';
  if (input)   input.value         = '';   // reset file picker
}
window.clearEntryInvoiceFile = clearEntryInvoiceFile;

// Called by the file <input> onchange — upload to R2
async function handleEntryInvoiceFile(input) {
  const file = input.files[0];
  if (!file) return;

  // Show spinner
  const badge   = document.getElementById('eInvoiceFileBadge');
  const spinner = document.getElementById('eInvoiceFileSpinner');
  const icon    = document.getElementById('eInvoiceFileIcon');
  const nameEl  = document.getElementById('eInvoiceFileName');
  if (badge)   { badge.style.display = 'flex'; badge.style.alignItems = 'center'; badge.style.gap = '.35rem'; }
  if (spinner) spinner.style.display = '';
  if (icon)    icon.style.display    = 'none';
  if (nameEl)  nameEl.textContent    = `Uploading ${file.name}…`;

  try {
    const uploaded = await apiUploadFile(file);
    setEntryInvoiceFileBadge(file.name, uploaded.key);
    showToast('Invoice file attached!', 'success');
  } catch (err) {
    clearEntryInvoiceFile();
    showToast('Upload failed: ' + err.message, 'error');
  }
}
window.handleEntryInvoiceFile = handleEntryInvoiceFile;

// Open file viewer modal with the attached invoice
function openEntryInvoiceFile() {
  const key      = document.getElementById('eInvoiceFileKey')?.value || '';
  const nameText = document.getElementById('eInvoiceFileName')?.textContent || '';
  if (!key) return;
  viewEntryInvoiceFile(key, nameText);
}
window.openEntryInvoiceFile = openEntryInvoiceFile;

// Shared viewer — called from entries table eye button OR form View button
function viewEntryInvoiceFile(fileKey, fileName) {
  const fileUrl = `/api/files/${fileKey}`;
  const ext     = (fileName || fileKey).split('.').pop().toLowerCase();
  const isPdf   = ext === 'pdf';
  const isImage = ['png','jpg','jpeg','webp','gif'].includes(ext);

  const titleEl    = document.getElementById('entryFileViewTitle');
  const contentEl  = document.getElementById('entryFileViewContent');
  const openLink   = document.getElementById('entryFileViewOpen');
  const dlLink     = document.getElementById('entryFileViewDownload');

  if (titleEl)   titleEl.textContent = fileName || fileKey;
  if (openLink)  { openLink.href = fileUrl; }
  if (dlLink)    { dlLink.href = fileUrl; dlLink.download = fileName || fileKey; }

  if (contentEl) {
    if (isPdf) {
      contentEl.innerHTML = `
        <iframe src="${esc(fileUrl)}" style="width:100%;height:460px;border:1px solid var(--border);border-radius:8px" title="${esc(fileName)}"></iframe>`;
    } else if (isImage) {
      contentEl.innerHTML = `
        <div style="text-align:center">
          <img src="${esc(fileUrl)}" alt="${esc(fileName)}"
               style="max-width:100%;max-height:480px;border-radius:8px;border:1px solid var(--border);object-fit:contain" />
        </div>`;
    } else {
      contentEl.innerHTML = `
        <div style="padding:2rem;text-align:center;color:var(--text-muted)">
          <i class="fas fa-file-alt" style="font-size:3rem;margin-bottom:1rem;display:block"></i>
          <div style="font-size:.9rem">${esc(fileName || fileKey)}</div>
          <div style="margin-top:1rem;font-size:.82rem">Preview not available — use Open or Download.</div>
        </div>`;
    }
  }
  openModal('entryFileViewModal');
}
window.viewEntryInvoiceFile = viewEntryInvoiceFile;

// ── Merge product ──────────────────────────────────────────────

let _mergeSurvivingId   = null;
let _mergeSurvivingName = null;

function openMergeModal(sourceId) {
  const product = allGeneric.find(g => g.id === sourceId);
  if (!product) return;

  _mergeSurvivingId   = null;
  _mergeSurvivingName = null;

  document.getElementById('mergeSourceId').value        = sourceId;
  document.getElementById('mergeSourceName').textContent = product.name;
  document.getElementById('mergeSurvivingSearch').value  = '';
  document.getElementById('mergeSurvivingDropdown').style.display = 'none';
  document.getElementById('mergeSurvivingChosen').style.display   = 'none';
  document.getElementById('confirmMergeBtn').disabled = true;

  openModal('mergeProductModal');
}

function closeMergeModal() {
  closeModal('mergeProductModal');
}

function onMergeSearchInput() {
  const q       = (document.getElementById('mergeSurvivingSearch').value || '').trim().toLowerCase();
  const sourceId = document.getElementById('mergeSourceId').value;
  const dd = document.getElementById('mergeSurvivingDropdown');

  _mergeSurvivingId   = null;
  _mergeSurvivingName = null;
  document.getElementById('mergeSurvivingChosen').style.display = 'none';
  document.getElementById('confirmMergeBtn').disabled = true;

  if (q.length < 1) { dd.style.display = 'none'; return; }

  const matches = allGeneric
    .filter(g => !g.deleted_at && g.id !== sourceId)
    .filter(g => (g.name || '').toLowerCase().includes(q))
    .slice(0, 10);

  if (!matches.length) { dd.innerHTML = '<div style="padding:.6rem 1rem;color:var(--text-muted);font-size:.85rem">No products found</div>'; dd.style.display = 'block'; return; }

  dd.innerHTML = matches.map(g => `
    <div class="merge-dd-item" onclick="selectMergeSurviving('${esc(g.id)}', '${esc(g.name)}')"
         style="padding:.55rem 1rem;cursor:pointer;font-size:.9rem;border-bottom:1px solid #f1f5f9"
         onmouseover="this.style.background='#f0f9ff'" onmouseout="this.style.background=''">
      <strong>${esc(g.name)}</strong>
      ${g.category ? `<span style="color:var(--text-muted);font-size:.78rem;margin-left:.4rem">${esc(g.category)}</span>` : ''}
    </div>`).join('');
  dd.style.display = 'block';
}

function selectMergeSurviving(id, name) {
  _mergeSurvivingId   = id;
  _mergeSurvivingName = name;
  document.getElementById('mergeSurvivingSearch').value  = name;
  document.getElementById('mergeSurvivingDropdown').style.display = 'none';
  const chosen = document.getElementById('mergeSurvivingChosen');
  chosen.textContent = '✓ Will merge into: ' + name;
  chosen.style.display = 'block';
  document.getElementById('confirmMergeBtn').disabled = false;
}

async function confirmMerge() {
  const sourceId   = document.getElementById('mergeSourceId').value;
  const sourceName = document.getElementById('mergeSourceName').textContent;
  if (!sourceId || !_mergeSurvivingId) return;

  const btn = document.getElementById('confirmMergeBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Merging…';

  try {
    await apiPost('products/merge', { merged_id: sourceId, surviving_id: _mergeSurvivingId });

    // Update local cache: mark merged product as soft-deleted
    const local = allGeneric.find(g => g.id === sourceId);
    if (local) local.deleted_at = new Date().toISOString();

    // Re-point the merged product's purchases onto the survivor in the local
    // cache too — the backend already moved them, but without this the survivor
    // wouldn't show the new supplier(s) until a full page reload.
    allEntries.forEach(e => {
      if (e.generic_product_id === sourceId) {
        e.generic_product_id   = _mergeSurvivingId;
        e.generic_product_name = _mergeSurvivingName;
      }
    });

    showToast(`"${sourceName}" merged into "${_mergeSurvivingName}"`, 'success');
    closeMergeModal();
    renderStats();
    renderProductTable();
    // If the survivor's detail modal happens to be open, refresh its entries too.
    if (typeof currentGenericId !== 'undefined' && currentGenericId === _mergeSurvivingId) {
      renderEntriesTable(_mergeSurvivingId);
    }

    // Offer to save as alias
    _showAliasPrompt(sourceName, _mergeSurvivingId, _mergeSurvivingName);
  } catch (e) {
    showToast('Merge failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-code-merge"></i> Confirm Merge';
  }
}

function _showAliasPrompt(mergedName, survivingId, survivingName) {
  const msg = document.getElementById('mergeAliasMsg');
  msg.innerHTML = `Do you want to remember <strong>${esc(mergedName)}</strong> as an alternate name for <strong>${esc(survivingName)}</strong>?<br><br>
    <span style="color:var(--text-muted);font-size:.85rem">If yes, future invoices containing <em>${esc(mergedName)}</em> will be automatically linked to <em>${esc(survivingName)}</em>.</span>`;

  const yesBtn = document.getElementById('mergeAliasYesBtn');
  yesBtn.onclick = async () => {
    try {
      await apiPost('tables/product_aliases', { alias_name: mergedName, generic_product_id: survivingId });
      showToast(`"${mergedName}" saved as alternate name for "${survivingName}"`, 'success');
    } catch (e) {
      showToast('Could not save alias: ' + e.message, 'error');
    }
    closeModal('mergeAliasModal');
  };

  openModal('mergeAliasModal');
}

window.openMergeModal     = openMergeModal;
window.closeMergeModal    = closeMergeModal;
window.onMergeSearchInput = onMergeSearchInput;
window.selectMergeSurviving = selectMergeSurviving;
window.confirmMerge       = confirmMerge;

// ── Group products (interchangeable items) ─────────────────────
// A distinct tool from Merge: pick 2+ active products you buy interchangeably and
// combine them under one general name, keeping every supplier's invoices as its
// own row. Backend POST /api/products/group does the work (rename survivor +
// merge the rest + remember absorbed names as vendor aliases).
let _groupSelected = new Set();

function openGroupProductsModal(preselectId) {
  _groupSelected = new Set();
  // Launched from a product row: start with that product ticked so the user only
  // needs to add its interchangeable siblings.
  if (preselectId && allGeneric.some(g => g.id === preselectId && !g.deleted_at)) {
    _groupSelected.add(preselectId);
  }
  document.getElementById('groupGeneralName').value   = '';
  document.getElementById('groupProductSearch').value = '';
  renderGroupPicker();
  updateGroupState();
  openModal('groupProductsModal');
}

// One checkbox row per active product, filtered by the search box. Selection is
// kept in _groupSelected so it survives filtering (a checked item scrolled out of
// the filter still counts).
function renderGroupPicker() {
  const list = document.getElementById('groupProductList');
  const q    = (document.getElementById('groupProductSearch').value || '').trim().toLowerCase();
  const rows = allGeneric
    .filter(g => !g.deleted_at)
    .filter(g => !q || (g.name || '').toLowerCase().includes(q))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (!rows.length) {
    list.innerHTML = `<div style="padding:.75rem 1rem;color:var(--text-muted);font-size:.85rem">No products found.</div>`;
    return;
  }

  list.innerHTML = rows.map(g => {
    const entries  = allEntries.filter(e => e.generic_product_id === g.id);
    const vendors  = [...new Set(entries.map(e => e.supplier_name).filter(Boolean))];
    const sub      = vendors.length === 0 ? 'no purchases'
                   : vendors.length === 1 ? vendors[0]
                   : `${vendors.length} vendors`;
    const checked  = _groupSelected.has(g.id) ? 'checked' : '';
    return `
      <label style="display:flex;align-items:center;gap:.6rem;padding:.5rem .75rem;border-bottom:1px solid #f1f5f9;cursor:pointer">
        <input type="checkbox" ${checked} onchange="toggleGroupProduct('${esc(g.id)}', this.checked)" style="width:16px;height:16px">
        <span style="font-weight:600;font-size:.9rem">${esc(g.name)}</span>
        <span style="color:var(--text-muted);font-size:.78rem;margin-left:auto">${esc(sub)}</span>
      </label>`;
  }).join('');
}

function toggleGroupProduct(id, checked) {
  if (checked) _groupSelected.add(id); else _groupSelected.delete(id);
  updateGroupState();
}

// Enable Group only with a name and 2+ products; echo what will happen.
function updateGroupState() {
  const name = (document.getElementById('groupGeneralName').value || '').trim();
  const btn  = document.getElementById('confirmGroupBtn');
  const hint = document.getElementById('groupHint');
  const n    = _groupSelected.size;
  btn.disabled = !(name && n >= 2);
  hint.textContent = n === 0 ? ''
    : n < 2 ? 'Select at least two products to group.'
    : `${n} products selected${name ? ` → will become one product called "${name}"` : ''}.`;
}

async function confirmGroup() {
  const name = (document.getElementById('groupGeneralName').value || '').trim();
  const ids  = [..._groupSelected];
  if (!name || ids.length < 2) return;

  const btn = document.getElementById('confirmGroupBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Grouping…';

  try {
    const res = await apiPost('products/group', { general_name: name, product_ids: ids });
    const survivorId = res.survivor_id;

    // Update local caches so the change shows without a reload: rename the
    // survivor, mark the others archived, and re-point their purchases.
    allGeneric.forEach(g => {
      if (g.id === survivorId) g.name = res.survivor_name;
      else if (ids.includes(g.id)) g.deleted_at = new Date().toISOString();
    });
    allEntries.forEach(e => {
      if (ids.includes(e.generic_product_id) && e.generic_product_id !== survivorId) {
        e.generic_product_id   = survivorId;
        e.generic_product_name = res.survivor_name;
      }
    });

    showToast(`Grouped ${ids.length} products into "${res.survivor_name}"`, 'success');
    closeModal('groupProductsModal');
    renderStats();
    renderProductTable();
  } catch (e) {
    showToast('Group failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-object-group"></i> Group';
  }
}

window.openGroupProductsModal = openGroupProductsModal;
window.renderGroupPicker      = renderGroupPicker;
window.toggleGroupProduct     = toggleGroupProduct;
window.updateGroupState       = updateGroupState;
window.confirmGroup           = confirmGroup;
