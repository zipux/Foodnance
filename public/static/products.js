/* ===== products.js (v2 — two-level: generic_products + product_entries) ===== */

const GENERIC_TABLE  = 'generic_products';
const ENTRIES_TABLE  = 'product_entries';
const PAGE_SIZE      = 15;

let currentPage       = 1;
let searchQuery       = '';
let allGeneric        = [];   // generic_products rows
let allEntries        = [];   // product_entries rows
let allSupplierList   = [];   // suppliers rows (for dropdowns)
let allInvoices       = [];   // invoices rows (for invoice number lookup)
let currentGenericId  = null; // which generic product is open in modal
let _pendingEntryInv  = null; // { genericId, entryId, itemName, packQty, packUnit, category }

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('productBody')) return;
  await loadAll();

  document.getElementById('searchInput').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    currentPage = 1;
    renderProductTable();
  });
  document.getElementById('openAddProductModal').addEventListener('click', openAddProductModal);
  document.getElementById('migrateOldBtn').addEventListener('click', async () => {
    if (!confirm('This will import all products from the old products table into the new two-level structure (generic_products + product_entries). Only run this once. Continue?')) return;
    await migrateOldProducts();
  });
  document.getElementById('saveProductBtn').addEventListener('click', saveGenericProduct);
  document.getElementById('closeModal').addEventListener('click', () => closeModal('productModal'));
  document.getElementById('cancelModal').addEventListener('click', () => closeModal('productModal'));
  document.getElementById('productModal').addEventListener('click', e => {
    if (e.target === document.getElementById('productModal')) closeModal('productModal');
  });

  // Entry form controls
  document.getElementById('openAddEntryBtn').addEventListener('click', openAddEntryForm);
  document.getElementById('eCost').addEventListener('input',    updateEntryCostPerUnit);
  document.getElementById('ePackQty').addEventListener('input',  updateEntryCostPerUnit);
  document.getElementById('ePackUnit').addEventListener('change', onPackUnitChange);

  // Inventory prompt modal (after saving a supplier entry)
  document.getElementById('closeEntryInvModal').addEventListener('click', () => closeModal('entryInvModal'));
  document.getElementById('skipEntryInvBtn').addEventListener('click',    () => closeModal('entryInvModal'));
  document.getElementById('confirmEntryInvBtn').addEventListener('click', confirmEntryInventory);
});

// ── Load everything ────────────────────────────────────────────
async function loadAll() {
  try {
    const [gd, ed, sd, ivd] = await Promise.all([
      apiGet(`tables/${GENERIC_TABLE}?page=1&limit=500`),
      apiGet(`tables/${ENTRIES_TABLE}?page=1&limit=1000`),
      apiGet(`tables/suppliers?page=1&limit=500`),
      apiGet(`tables/invoices?page=1&limit=1000`),
    ]);
    allGeneric      = gd.data  || [];
    allEntries      = ed.data  || [];
    allSupplierList = sd.data  || [];
    allInvoices     = ivd.data || [];
    renderProductTable();
    renderStats();
  } catch (e) {
    console.error(e);
    document.getElementById('productBody').innerHTML =
      `<tr><td colspan="6" class="empty-row"><i class="fas fa-exclamation-triangle"></i> Failed to load products.</td></tr>`;
  }
}

// ── Invoice number lookup ──────────────────────────────────────
function invoiceNumber(invoiceId) {
  if (!invoiceId) return '';
  const inv = allInvoices.find(i => i.id === invoiceId);
  return (inv && inv.invoice_number) ? inv.invoice_number : '';
}

// ── Render generic product table ───────────────────────────────
function filteredGeneric() {
  if (!searchQuery) return allGeneric;
  const q = searchQuery.toLowerCase();
  return allGeneric.filter(g =>
    (g.name     || '').toLowerCase().includes(q) ||
    (g.category || '').toLowerCase().includes(q)
  );
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
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row"><i class="fas fa-box-open"></i> No products found.</td></tr>`;
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

    // Best (lowest) cost per unit across entries
    // CHANGE 1: prefer stored cost_per_unit; fall back to computing from cost/pack_qty
    let bestCpu = null;
    let bestUnit = '';
    entries.forEach(e => {
      const cpu = (e.cost_per_unit != null && e.cost_per_unit > 0)
        ? e.cost_per_unit
        : (entryPackQty(e) > 0 ? e.cost / entryPackQty(e) : e.cost);
      if (bestCpu === null || cpu < bestCpu) { bestCpu = cpu; bestUnit = entryPackUnit(e); }
    });

    // Most recent purchase date
    const dates = entries.map(e => e.purchase_date).filter(Boolean).sort().reverse();
    const lastPurchase = dates[0] || '—';

    return `
      <tr class="product-row" onclick="openEditProduct('${esc(g.id)}')" title="Click to edit">
        <td><strong>${esc(g.name)}</strong></td>
        <td>${g.category ? `<span class="category-badge cat-${slugify(g.category)}">${esc(g.category)}</span>` : '—'}</td>
        <td>${supplierLabel}</td>
        <td>${bestCpu !== null ? fmt(bestCpu) + ' / ' + esc(bestUnit) : '—'}</td>
        <td style="color:var(--text-muted);font-size:.85rem">${lastPurchase}</td>
        <td onclick="event.stopPropagation()" style="white-space:nowrap">
          <button class="btn btn-primary btn-icon" onclick="openEditProduct('${esc(g.id)}')" title="Edit product">
            <i class="fas fa-pen"></i>
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
  const total = allGeneric.length;
  const cats  = ['Ingredients','Packaging','Disposables','Non-Alcoholic Beverages','Alcohol','Cleaning & Sanitation','Linen','Other'];
  const catCounts = cats.map(c => ({ label: c, count: allGeneric.filter(g => g.category === c).length }));
  const uncat = allGeneric.filter(g => !g.category).length;

  // Expiry from entries
  const today = new Date(); today.setHours(0,0,0,0);
  const expiring = allEntries.filter(e => {
    if (!e.expiry_date) return false;
    const d = new Date(e.expiry_date); if (isNaN(d)) return false;
    const days = Math.floor((d - today) / 86400000);
    return days >= 0 && days <= 30;
  }).length;
  const expired = allEntries.filter(e => {
    if (!e.expiry_date) return false;
    const d = new Date(e.expiry_date); if (isNaN(d)) return false;
    return Math.floor((d - today) / 86400000) < 0;
  }).length;

  el.innerHTML = `
    <div class="stat-chip"><i class="fas fa-boxes"></i> ${total} Products</div>
    ${catCounts.map(c => c.count > 0 ? `<div class="stat-chip cat-chip cat-${slugify(c.label)}"><i class="fas fa-tag"></i> ${c.count} ${c.label}</div>` : '').join('')}
    ${uncat > 0 ? `<div class="stat-chip" style="background:#f1f5f9;color:#64748b"><i class="fas fa-question-circle"></i> ${uncat} Uncategorised</div>` : ''}
    ${expiring > 0 ? `<div class="stat-chip" style="background:#fef9c3;color:#854d0e"><i class="fas fa-clock"></i> ${expiring} Expiring soon</div>` : ''}
    ${expired  > 0 ? `<div class="stat-chip" style="background:#fee2e2;color:#991b1b"><i class="fas fa-skull-crossbones"></i> ${expired} Expired</div>` : ''}
  `;
}

// ── Add/Edit Generic Product Modal ─────────────────────────────
async function openAddProductModal() {
  currentGenericId = null;
  document.getElementById('modalTitle').textContent = 'Add Product';
  document.getElementById('saveProductBtn').innerHTML = '<i class="fas fa-save"></i> Save Product';
  document.getElementById('editProductId').value = '';
  document.getElementById('pName').value        = '';
  document.getElementById('pCategory').value    = '';
  document.getElementById('pSubUnitName').value = '';
  document.getElementById('pSubUnitQty').value  = '';
  document.getElementById('pAvgWeight').value   = '';

  // Show entry form immediately — user fills everything on one screen
  document.getElementById('openAddEntryBtn').style.display = 'none';
  document.getElementById('entriesPlaceholder').style.display = 'none';
  document.getElementById('entriesTableScroll').classList.add('hidden');
  document.getElementById('editEntryId').value   = '';
  document.getElementById('eVendorName').value   = '';
  document.getElementById('eSku').value          = '';
  document.getElementById('ePackQty').value      = '';
  document.getElementById('eCost').value         = '';
  document.getElementById('ePurchaseDate').value = '';
  document.getElementById('eExpiry').value       = '';
  document.getElementById('eInvoiceRef').value   = '';
  document.getElementById('entryForm').classList.remove('hidden');

  await loadSupplierDropdown();
  openModal('productModal');
}

async function openEditProduct(id) {
  const g = allGeneric.find(x => x.id === id);
  if (!g) return;
  currentGenericId = id;

  // ── Fill product fields ─────────────────────────────────────
  document.getElementById('modalTitle').textContent = 'Edit Product';
  document.getElementById('saveProductBtn').innerHTML = '<i class="fas fa-save"></i> Save Changes';
  document.getElementById('editProductId').value    = id;
  document.getElementById('pName').value            = g.name         || '';
  document.getElementById('pCategory').value        = g.category     || '';
  document.getElementById('pSubUnitName').value     = g.sub_unit_name        || '';
  document.getElementById('pSubUnitQty').value      = g.sub_unit_qty         || '';
  document.getElementById('pAvgWeight').value       = g.avg_weight_per_unit  != null ? g.avg_weight_per_unit : '';

  await loadSupplierDropdown();

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
    document.getElementById('ePackUnit').value      = latest.pack_unit        || 'kg';
    document.getElementById('ePackUnit').dataset.prevUnit = latest.pack_unit || 'kg';
    // CHANGE 4: show unit price (cost_per_unit), not line total (cost)
    document.getElementById('eCost').value          = _getStoredCpu(latest) || '';
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
    document.getElementById('ePackUnit').value      = 'kg';
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
  renderEntriesTable(id);
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
  const payload = {
    name,
    category,
    sub_unit_name:        document.getElementById('pSubUnitName').value.trim() || null,
    sub_unit_qty:         parseFloat(document.getElementById('pSubUnitQty').value) || null,
    avg_weight_per_unit:  isNaN(avgWeightRaw) ? null : avgWeightRaw,
  };

  const btn = document.getElementById('saveProductBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    let savedId = id;
    if (id) {
      // ── Edit existing generic product ──
      await apiPut(`tables/${GENERIC_TABLE}/${id}`, payload);
    } else {
      // ── Create new generic product ──
      const created = await apiPost(`tables/${GENERIC_TABLE}`, payload);
      savedId = created.id;
      currentGenericId = savedId;
      document.getElementById('editProductId').value = savedId;
    }

    // Save entry if any entry fields are filled (always true when editing an existing entry)
    const entryId = document.getElementById('editEntryId').value;
    if (entryHasData || entryId) {
      await _saveEntryForGeneric(savedId, name, category);
      // _saveEntryForGeneric handles toast + inventory prompt
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
  if (!confirm('Delete this product and ALL its supplier entries? This cannot be undone.')) return;
  try {
    // Delete all entries first
    const mine = allEntries.filter(e => e.generic_product_id === id);
    for (const e of mine) await apiDelete(`tables/${ENTRIES_TABLE}/${e.id}`);
    await apiDelete(`tables/${GENERIC_TABLE}/${id}`);
    showToast('Product deleted.', 'warning');
    await loadAll();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

// ── Supplier entries table (inside modal) ──────────────────────
function renderEntriesTable(genericId) {
  const entries  = allEntries.filter(e => e.generic_product_id === genericId)
    .slice().sort((a, b) => (a.purchase_date || '') > (b.purchase_date || '') ? 1 : -1); // oldest first = FIFO order

  const scroll = document.getElementById('entriesTableScroll');
  const tbody  = document.getElementById('entriesBody');

  if (!entries.length) {
    scroll.classList.add('hidden');
    return;
  }
  scroll.classList.remove('hidden');

  // Find most recent price for variance calculation
  // CHANGE 2: prefer stored cost_per_unit for latestCpu
  const sorted    = [...entries].sort((a, b) => (a.purchase_date || '') < (b.purchase_date || '') ? 1 : -1);
  const latestCpu = sorted[0]
    ? ((sorted[0].cost_per_unit != null && sorted[0].cost_per_unit > 0)
        ? sorted[0].cost_per_unit
        : (entryPackQty(sorted[0]) > 0 ? sorted[0].cost / entryPackQty(sorted[0]) : sorted[0].cost))
    : null;

  tbody.innerHTML = entries.map(e => {
    // CHANGE 3: prefer stored cost_per_unit for per-row cpu
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
        <td style="font-size:.8rem">${e.purchase_date || '—'}</td>
        <td style="font-size:.8rem">${e.expiry_date ? daysBadge(daysLeft) : '—'}</td>
        <td style="font-size:.8rem">
          ${e.invoice_ref
            ? (e.invoice_id
                ? `<a href="/invoices.html#${esc(e.invoice_id)}" title="View invoice" style="color:var(--primary);font-weight:500;text-decoration:none">${esc(e.invoice_ref)}</a>`
                : esc(e.invoice_ref))
            : '—'}
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
}

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

function openAddEntryForm() {
  document.getElementById('editEntryId').value    = '';
  document.getElementById('eSupplier').value      = '';
  document.getElementById('eVendorName').value    = '';
  document.getElementById('eSku').value           = '';
  document.getElementById('ePackQty').value       = '';
  document.getElementById('ePackUnit').value      = 'kg';
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
  // CHANGE 5: show unit price (cost_per_unit), not line total (cost)
  document.getElementById('eCost').value         = _getStoredCpu(e) || '';
  // Populate pack qty + unit directly from columns
  document.getElementById('ePackQty').value  = e.pack_qty  || '';
  document.getElementById('ePackUnit').value = e.pack_unit || 'kg';
  document.getElementById('ePackUnit').dataset.prevUnit = e.pack_unit || 'kg';
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

function _getStoredCpu(e) {
  const cpu = parseFloat(e.cost_per_unit);
  if (!isNaN(cpu) && cpu > 0) return cpu;
  const qty = entryPackQty(e);
  const cost = parseFloat(e.cost) || 0;
  return qty > 0 ? cost / qty : cost;
}

function updateEntryCostPerUnit() {
  const cost    = parseFloat(document.getElementById('eCost').value);
  const qty     = parseFloat(document.getElementById('ePackQty').value);
  const unit    = document.getElementById('ePackUnit').value;
  const box     = document.getElementById('eCostPerUnitBox');
  const display = document.getElementById('eCostPerUnitDisplay');
  box.classList.remove('ready', 'error');
  if (isNaN(cost) || isNaN(qty) || qty <= 0) {
    display.textContent = 'Enter cost & pack size';
    return;
  }
  box.classList.add('ready');
  display.textContent = `${fmt(cost)} / ${unit}`;
}

// ── Unit conversion for ePackUnit dropdown ─────────────────────
const _WEIGHT_UNITS = ['kg', 'lb', 'g'];
const _VOLUME_UNITS = ['L', 'ml'];
const _COUNT_UNITS  = ['Can', 'Pack', 'Case', 'Dozen'];

// Returns { cost: number } on success, or { error: string } on failure.
// All costs are expressed as cost-per-unit-of-measure (e.g. $/kg, $/lb).
// avg_weight_per_unit is in kg (used only for Each conversions).
function _convertUnitCost(cost, fromUnit, toUnit, avgWeightPerUnit) {
  if (fromUnit === toUnit) return { cost };

  const fromIsWeight = _WEIGHT_UNITS.includes(fromUnit);
  const fromIsVolume = _VOLUME_UNITS.includes(fromUnit);
  const fromIsEach   = fromUnit === 'Each';
  const fromIsCount  = _COUNT_UNITS.includes(fromUnit);

  const toIsWeight   = _WEIGHT_UNITS.includes(toUnit);
  const toIsVolume   = _VOLUME_UNITS.includes(toUnit);
  const toIsEach     = toUnit === 'Each';
  const toIsCount    = _COUNT_UNITS.includes(toUnit);

  // Can/Pack/Case/Dozen can't convert to or from anything
  if (fromIsCount || toIsCount) {
    return { error: `Cannot convert ${fromUnit} to ${toUnit}` };
  }

  // Weight <-> Volume: not possible
  if ((fromIsWeight && toIsVolume) || (fromIsVolume && toIsWeight)) {
    return { error: `Cannot convert ${fromUnit} to ${toUnit}` };
  }

  // Weight or Volume -> Each: not possible
  if ((fromIsWeight || fromIsVolume) && toIsEach) {
    return { error: `Cannot convert ${fromUnit} to ${toUnit}` };
  }

  // Each -> Weight or Volume: requires avg_weight_per_unit
  if (fromIsEach && toIsVolume) {
    return { error: `Cannot convert ${fromUnit} to ${toUnit}` };
  }
  if (fromIsEach && toIsWeight) {
    if (!avgWeightPerUnit || isNaN(avgWeightPerUnit) || avgWeightPerUnit <= 0) {
      return { error: 'Set Average Weight per Unit first to enable conversion' };
    }
    // avg_weight_per_unit is in kg; cost_per_kg = cost_per_each / avg_weight_per_unit
    const costPerKg = cost / avgWeightPerUnit;
    if (toUnit === 'kg') return { cost: costPerKg };
    if (toUnit === 'lb') return { cost: costPerKg * 0.45359 };
    if (toUnit === 'g')  return { cost: costPerKg * 0.001 };
  }

  // Weight <-> Weight: normalise through kg
  if (fromIsWeight && toIsWeight) {
    let costPerKg;
    if (fromUnit === 'kg') costPerKg = cost;
    if (fromUnit === 'lb') costPerKg = cost * 2.20462;
    if (fromUnit === 'g')  costPerKg = cost * 1000;
    if (toUnit === 'kg') return { cost: costPerKg };
    if (toUnit === 'lb') return { cost: costPerKg * 0.45359 };
    if (toUnit === 'g')  return { cost: costPerKg * 0.001 };
  }

  // Volume <-> Volume: normalise through L
  if (fromIsVolume && toIsVolume) {
    const costPerL = fromUnit === 'L' ? cost : cost * 1000;
    return { cost: toUnit === 'L' ? costPerL : costPerL * 0.001 };
  }

  return { error: `Cannot convert ${fromUnit} to ${toUnit}` };
}

async function onPackUnitChange() {
  const select  = document.getElementById('ePackUnit');
  const newUnit = select.value;
  const prevUnit = select.dataset.prevUnit || newUnit;

  // Track the new unit so subsequent changes have the right baseline
  select.dataset.prevUnit = newUnit;

  if (newUnit === prevUnit) { updateEntryCostPerUnit(); return; }

  const costStr = document.getElementById('eCost').value.trim();
  const cost    = parseFloat(costStr);

  // No cost entered yet — nothing to convert, just update display
  if (!costStr || isNaN(cost) || cost <= 0) { updateEntryCostPerUnit(); return; }

  // Look up avg_weight_per_unit for the current product
  let avgWeight = null;
  if (currentGenericId) {
    const g = allGeneric.find(x => x.id === currentGenericId);
    if (g) avgWeight = parseFloat(g.avg_weight_per_unit) || null;
  }

  const result = _convertUnitCost(cost, prevUnit, newUnit, avgWeight);

  if (result.error) {
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
    }
    // Either way, no recalculation — just update the display label
    updateEntryCostPerUnit();
    return;
  }

  // Round to 6 significant decimal places, strip trailing zeros
  document.getElementById('eCost').value = parseFloat(result.cost.toFixed(6));
  updateEntryCostPerUnit();
}

// Called by the inline "Save Entry" button (editing an existing product)
async function saveEntry() {
  const genericId = document.getElementById('editProductId').value;
  // If no genericId yet (shouldn't happen for edits, but guard anyway)
  if (!genericId) {
    showToast('Please save the product name & category first.', 'error');
    return;
  }
  await _saveEntryForGeneric(genericId, null, null);
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
  const gCategory  = overrideCategory || g?.category || 'Ingredients';
  const supplier   = allSupplierList.find(s => s.id === supplierId);
  const expiry     = document.getElementById('eExpiry').value;
  const pQty       = parseFloat(packQtyVal) || 1;
  const pUnit      = document.getElementById('ePackUnit').value;

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

  // CHANGE 6: eCost now holds the unit price; derive line total from unit price × pack qty
  const unitPrice = cost;
  const lineTotal = pQty > 0 ? unitPrice * pQty : unitPrice;

  const payload = {
    generic_product_id:   genericId,
    generic_product_name: gName,
    supplier_id:          supplierId,
    supplier_name:        supplier?.name || '',
    vendor_item_name:     document.getElementById('eVendorName').value.trim(),
    sku:                  document.getElementById('eSku').value.trim(),
    pack_qty:             pQty,
    pack_unit:            pUnit,
    cost:                 lineTotal,      // line total  (e.g. 106.80 for 8 × $13.35)
    cost_per_unit:        unitPrice,      // unit price  (e.g. 13.35)
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
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
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
    await window.invHelpers.upsertInventory({
      itemId:    _pendingEntryInv.genericId,
      itemType:  'raw_material',
      itemName:  _pendingEntryInv.itemName,
      category:  _pendingEntryInv.category,
      unit:      _pendingEntryInv.packUnit,
      change:    qty,
      reason:    note || 'Stock-in from product entry',
    });
    showToast(`${qty} ${_pendingEntryInv.packUnit} of ${_pendingEntryInv.itemName} added to inventory!`, 'success');
    closeModal('entryInvModal');
    _pendingEntryInv = null;
  } catch (e) {
    showToast('Failed to add to inventory: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-warehouse"></i> Add to Inventory';
  }
}

// ── FIFO cost helper (used by recipes.js & finished-products.js) ──
// Returns cost-per-unit for a generic product using FIFO (oldest purchase first).
function fifoCostPerUnit(genericId) {
  const entries = allEntries
    .filter(e => e.generic_product_id === genericId)
    .sort((a, b) => (a.purchase_date || '') > (b.purchase_date || '') ? 1 : -1); // oldest first
  if (!entries.length) return { cpu: 0, unit: 'unit', packUnit: 'unit', subUnitName: '', subUnitQty: 0 };
  const oldest  = entries[0];
  const qty     = entryPackQty(oldest);
  const unit    = entryPackUnit(oldest);
  const g       = allGeneric.find(x => x.id === genericId);
  // CHANGE 7: prefer stored cost_per_unit; fall back to computing from cost/pack_qty
  return {
    cpu: (oldest.cost_per_unit != null && oldest.cost_per_unit > 0)
           ? oldest.cost_per_unit
           : (qty > 0 ? oldest.cost / qty : oldest.cost),
    unit,
    packUnit:     unit,
    subUnitName:  g?.sub_unit_name || '',
    subUnitQty:   g?.sub_unit_qty  || 0,
  };
}

// ── Expose globally for recipes.js and finished-products.js ──
window.productsAPI = {
  allGeneric:     () => allGeneric,
  allEntries:     () => allEntries,
  fifoCostPerUnit,
  entryPackQty,
  entryPackUnit,
};

// ── bulkSaveProducts: used by invoice.js to save rows from an uploaded invoice ──
// Each row has: { name, brand, sku, pack_size, cost, expiry_date, invoice_ref,
//                 invoice_id, invoice_file_key, invoice_file_name }
// Optional: vendor_name (string) — auto-creates the supplier if new.
// Logic: find-or-create supplier + generic_product by name, always add a new product_entry.
async function bulkSaveProducts(rows, vendorName = '') {
  const valid = rows.filter(r => r.name && r.name.trim());
  if (!valid.length) return 0;

  try {
    const result = await apiPost('bulk/upsert-products', {
      vendor_name: vendorName || '',
      products: valid,
    });

    // Refresh internal cache so inventory prompt can find the new records
    const [gd, ed] = await Promise.all([
      apiGet(`tables/${GENERIC_TABLE}?page=1&limit=500`),
      apiGet(`tables/${ENTRIES_TABLE}?page=1&limit=1000`),
    ]);
    allGeneric = gd.data || [];
    allEntries = ed.data || [];

    // Return a result object so invoice.js can show a smart toast
    return result;
  } catch (e) {
    console.error('bulkSaveProducts error:', e);
    return { saved: 0, created_generics: 0, reused_generics: 0 };
  }
}
window.bulkSaveProducts = bulkSaveProducts;

// ── loadProducts: called by invoice.js after saving ───────────
async function loadProducts() {
  await loadAll();
}
window.loadProducts = loadProducts;

// ── Migration helper: run once to migrate old products table ───
async function migrateOldProducts() {
  try {
    const data = await apiGet(`tables/products?page=1&limit=500`);
    const old  = data.data || [];
    if (!old.length) return;

    let migrated = 0;
    for (const p of old) {
      // 1. Create generic product
      const generic = await apiPost(`tables/${GENERIC_TABLE}`, {
        name:          p.name,
        category:      p.category || 'Ingredients',
        sub_unit_name: p.sub_unit_name || null,
        sub_unit_qty:  p.sub_unit_qty  || null,
      });
      // 2. Create one supplier entry with existing data (no vendor assigned)
      await apiPost(`tables/${ENTRIES_TABLE}`, {
        generic_product_id:   generic.id,
        generic_product_name: p.name,
        supplier_id:          '',
        supplier_name:        '',
        vendor_item_name:     p.name,
        sku:                  p.sku          || '',
        pack_size:            p.pack_size    || '',
        cost:                 p.cost         || 0,
        purchase_date:        p.expiry_date  ? '' : '',
        expiry_date:          p.expiry_date  || '',
        days_left:            p.days_left    || null,
        invoice_ref:          p.invoice_ref  || '',
      });
      migrated++;
    }
    showToast(`Migrated ${migrated} products to new structure!`, 'success');
    await loadAll();
  } catch (e) {
    showToast('Migration failed: ' + e.message, 'error');
  }
}
window.migrateOldProducts = migrateOldProducts;

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
