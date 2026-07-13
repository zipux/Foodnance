/* ===== suppliers.js ===== */
const SUPPLIERS_TABLE = 'suppliers';
let allSuppliers = [];
let supplierSearch = '';

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('supplierBody')) return;
  await loadSuppliers();

  document.getElementById('supplierSearch').addEventListener('input', e => {
    supplierSearch = e.target.value.trim();
    renderSuppliers();
  });
  document.getElementById('openAddSupplierBtn').addEventListener('click', openAddSupplierModal);
  document.getElementById('closeSupplierModal').addEventListener('click', () => closeModal('supplierModal'));
  document.getElementById('cancelSupplierModal').addEventListener('click', () => closeModal('supplierModal'));
  document.getElementById('supplierModal').addEventListener('click', e => {
    if (e.target === document.getElementById('supplierModal')) closeModal('supplierModal');
  });
  document.getElementById('saveSupplierBtn').addEventListener('click', saveSupplier);
});

async function loadSuppliers() {
  try {
    const data = await apiGet(`tables/${SUPPLIERS_TABLE}?page=1&limit=500`);
    allSuppliers = data.data || [];
    renderSuppliers();
  } catch (e) {
    document.getElementById('supplierBody').innerHTML =
      `<tr><td colspan="5" class="empty-row"><i class="fas fa-exclamation-triangle"></i> Failed to load suppliers.</td></tr>`;
  }
}

function renderSuppliers() {
  const tbody = document.getElementById('supplierBody');
  let list = allSuppliers;
  if (supplierSearch) {
    const q = supplierSearch.toLowerCase();
    list = list.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.contact || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q)
    );
  }
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row"><i class="fas fa-truck"></i> No suppliers yet. Add your first one!</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(s => `
    <tr class="product-row" onclick="openEditSupplier('${esc(s.id)}')" title="Click to edit">
      <td><strong>${esc(s.name)}</strong></td>
      <td>${esc(s.contact || '—')}</td>
      <td>${esc(s.email || '—')}</td>
      <td>${esc(s.notes || '—')}</td>
      <td onclick="event.stopPropagation()">
        <button class="btn btn-danger btn-icon" onclick="deleteSupplier('${esc(s.id)}')" title="Delete">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

function openAddSupplierModal() {
  document.getElementById('supplierModalTitle').textContent = 'Add Supplier';
  document.getElementById('editSupplierId').value = '';
  ['sName','sContact','sEmail','sNotes'].forEach(id => document.getElementById(id).value = '');
  openModal('supplierModal');
}

function openEditSupplier(id) {
  const s = allSuppliers.find(x => x.id === id);
  if (!s) return;
  document.getElementById('supplierModalTitle').textContent = 'Edit Supplier';
  document.getElementById('editSupplierId').value = id;
  document.getElementById('sName').value    = s.name    || '';
  document.getElementById('sContact').value = s.contact || '';
  document.getElementById('sEmail').value   = s.email   || '';
  document.getElementById('sNotes').value   = s.notes   || '';
  openModal('supplierModal');
}

async function saveSupplier() {
  const id   = document.getElementById('editSupplierId').value;
  const name = document.getElementById('sName').value.trim();
  if (!name) { showToast('Supplier name is required.', 'error'); return; }

  const payload = {
    name,
    contact: document.getElementById('sContact').value.trim(),
    email:   document.getElementById('sEmail').value.trim(),
    notes:   document.getElementById('sNotes').value.trim(),
  };
  try {
    if (id) {
      // Dedicated endpoint: updates the supplier AND cascades a name change
      // to product entries, invoices, mappings and fee templates.
      await apiPut(`suppliers/${id}`, payload);
      showToast('Supplier updated everywhere!', 'success');
    } else {
      await apiPost(`tables/${SUPPLIERS_TABLE}`, payload);
      showToast('Supplier added!', 'success');
    }
    closeModal('supplierModal');
    await loadSuppliers();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

async function deleteSupplier(id) {
  if (!confirm('Delete this supplier? This cannot be undone.')) return;
  try {
    await apiDelete(`tables/${SUPPLIERS_TABLE}/${id}`);
    showToast('Supplier deleted.', 'warning');
    await loadSuppliers();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

// Expose for use in products.js dropdown building
async function fetchAllSuppliers() {
  try {
    const data = await apiGet(`tables/${SUPPLIERS_TABLE}?page=1&limit=500`);
    return data.data || [];
  } catch (_) { return []; }
}
window.fetchAllSuppliers = fetchAllSuppliers;
