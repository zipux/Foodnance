/* ===== staff.js ===== */

const PAGE_SIZE = 20;
let allStaff = [];
let filtered = [];
let currentPage = 1;
let certsByStaff = {}; // staffId → [certs]

document.addEventListener('DOMContentLoaded', async () => {
  await loadStaff();
  await loadCertsByStaff();

  document.getElementById('staffSearch').addEventListener('input', () => { currentPage = 1; applyFilters(); });
  document.getElementById('deptFilter').addEventListener('change', () => { currentPage = 1; applyFilters(); });
  document.getElementById('statusFilter').addEventListener('change', () => { currentPage = 1; applyFilters(); });

  document.getElementById('openAddStaffBtn').addEventListener('click', openAddStaff);
  document.getElementById('saveStaffBtn').addEventListener('click', saveStaff);
  document.getElementById('cancelStaffModal').addEventListener('click', () => closeModal('staffModal'));
  document.getElementById('closeStaffModal').addEventListener('click', () => closeModal('staffModal'));
  document.getElementById('deleteStaffBtn').addEventListener('click', deleteStaff);
  document.getElementById('closeStaffCertModal').addEventListener('click', () => closeModal('staffCertModal'));
  document.getElementById('closeStaffCertBtn').addEventListener('click', () => closeModal('staffCertModal'));
});

async function loadStaff() {
  try {
    const data = await apiGet('tables/staff?limit=500');
    allStaff = data.data || [];
    populateDeptFilter();
    applyFilters();
    renderStats();
  } catch (e) {
    document.getElementById('staffBody').innerHTML =
      `<tr><td colspan="9" class="empty-row"><i class="fas fa-exclamation-triangle"></i> Failed to load staff.</td></tr>`;
  }
}

async function loadCertsByStaff() {
  try {
    const data = await apiGet('tables/staff_certifications?limit=500');
    certsByStaff = {};
    for (const c of (data.data || [])) {
      if (!certsByStaff[c.staff_id]) certsByStaff[c.staff_id] = [];
      certsByStaff[c.staff_id].push(c);
    }
  } catch (e) { /* ignore */ }
}

function populateDeptFilter() {
  const depts = [...new Set(allStaff.map(s => s.department).filter(Boolean))].sort();
  const sel = document.getElementById('deptFilter');
  sel.innerHTML = '<option value="">All Departments</option>' +
    depts.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');

  // Also populate datalist in modal
  const dl = document.getElementById('deptList');
  if (dl) dl.innerHTML = depts.map(d => `<option value="${esc(d)}">`).join('');
}

function applyFilters() {
  const q = document.getElementById('staffSearch').value.trim().toLowerCase();
  const dept = document.getElementById('deptFilter').value;
  const status = document.getElementById('statusFilter').value;

  filtered = allStaff.filter(s => {
    if (dept && s.department !== dept) return false;
    if (status && s.status !== status) return false;
    if (q) {
      const hay = [s.full_name, s.role, s.email, s.phone, s.department].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  renderTable();
}

function renderStats() {
  const active = allStaff.filter(s => s.status === 'Active').length;
  const inactive = allStaff.filter(s => s.status === 'Inactive').length;
  const onLeave = allStaff.filter(s => s.status === 'On Leave').length;
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  let expiring = 0, expired = 0;
  for (const certs of Object.values(certsByStaff)) {
    for (const c of certs) {
      if (c.expiry_date <= today) expired++;
      else if (c.expiry_date <= soon) expiring++;
    }
  }

  document.getElementById('staffStats').innerHTML = `
    <div class="stat-card"><div class="stat-value">${allStaff.length}</div><div class="stat-label">Total Staff</div></div>
    <div class="stat-card"><div class="stat-value" style="color:#059669">${active}</div><div class="stat-label">Active</div></div>
    <div class="stat-card"><div class="stat-value" style="color:#6b7280">${inactive}</div><div class="stat-label">Inactive</div></div>
    <div class="stat-card"><div class="stat-value" style="color:#d97706">${onLeave}</div><div class="stat-label">On Leave</div></div>
    <div class="stat-card"><div class="stat-value" style="color:#d97706">${expiring}</div><div class="stat-label">Certs Expiring Soon</div></div>
    <div class="stat-card"><div class="stat-value" style="color:#dc2626">${expired}</div><div class="stat-label">Certs Expired</div></div>
  `;
}

function renderTable() {
  const total = filtered.length;
  const pages = Math.ceil(total / PAGE_SIZE) || 1;
  if (currentPage > pages) currentPage = pages;
  const slice = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const tbody = document.getElementById('staffBody');
  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row"><i class="fas fa-inbox"></i> No staff found.</td></tr>`;
  } else {
    tbody.innerHTML = slice.map(s => {
      const certs = certsByStaff[s.id] || [];
      const expiredCerts = certs.filter(c => c.expiry_date <= today).length;
      const expiringCerts = certs.filter(c => c.expiry_date > today && c.expiry_date <= soon).length;
      const certBadge = expiredCerts > 0
        ? `<span class="badge badge-red"><i class="fas fa-exclamation-circle"></i> ${expiredCerts} expired</span>`
        : expiringCerts > 0
          ? `<span class="badge badge-yellow"><i class="fas fa-clock"></i> ${expiringCerts} expiring</span>`
          : certs.length > 0
            ? `<span class="badge badge-green"><i class="fas fa-check"></i> ${certs.length} valid</span>`
            : `<span class="badge badge-gray"><i class="fas fa-minus"></i> None</span>`;

      const statusColors = { 'Active': 'badge-green', 'Inactive': 'badge-gray', 'On Leave': 'badge-yellow' };
      const statusBadge = `<span class="badge ${statusColors[s.status] || 'badge-gray'}">${esc(s.status || 'Active')}</span>`;

      return `<tr>
        <td style="font-weight:600">${esc(s.full_name)}</td>
        <td>${esc(s.role || '—')}</td>
        <td>${esc(s.department || '—')}</td>
        <td><a href="mailto:${esc(s.email)}" style="color:var(--primary)">${esc(s.email || '—')}</a></td>
        <td>${esc(s.phone || '—')}</td>
        <td>${fmtDate(s.hire_date)}</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn btn-icon btn-secondary btn-sm" onclick="viewStaffCerts('${esc(s.id)}','${esc(s.full_name)}')" title="View Certifications">
            ${certBadge}
          </button>
        </td>
        <td>
          <button class="btn btn-icon btn-secondary btn-sm" onclick="openEditStaff('${esc(s.id)}')" title="Edit">
            <i class="fas fa-edit"></i>
          </button>
        </td>
      </tr>`;
    }).join('');
  }

  // Pagination
  const pg = document.getElementById('staffPagination');
  if (pages <= 1) { pg.innerHTML = ''; return; }
  pg.innerHTML = Array.from({ length: pages }, (_, i) =>
    `<button class="page-btn ${i + 1 === currentPage ? 'active' : ''}" onclick="goPage(${i + 1})">${i + 1}</button>`
  ).join('');
}

function goPage(p) { currentPage = p; renderTable(); }

// ── Staff Modal ─────────────────────────────────────────────────
function openAddStaff() {
  document.getElementById('staffModalTitle').innerHTML = '<i class="fas fa-user-plus"></i> Add Staff Member';
  document.getElementById('editStaffId').value = '';
  document.getElementById('sfName').value = '';
  document.getElementById('sfRole').value = '';
  document.getElementById('sfDept').value = '';
  document.getElementById('sfEmail').value = '';
  document.getElementById('sfPhone').value = '';
  document.getElementById('sfHireDate').value = '';
  document.getElementById('sfStatus').value = 'Active';
  document.getElementById('sfNotes').value = '';
  document.getElementById('deleteStaffBtn').classList.add('hidden');
  openModal('staffModal');
}

function openEditStaff(id) {
  const s = allStaff.find(x => x.id === id);
  if (!s) return;
  document.getElementById('staffModalTitle').innerHTML = '<i class="fas fa-user-edit"></i> Edit Staff Member';
  document.getElementById('editStaffId').value = s.id;
  document.getElementById('sfName').value = s.full_name || '';
  document.getElementById('sfRole').value = s.role || '';
  document.getElementById('sfDept').value = s.department || '';
  document.getElementById('sfEmail').value = s.email || '';
  document.getElementById('sfPhone').value = s.phone || '';
  document.getElementById('sfHireDate').value = s.hire_date || '';
  document.getElementById('sfStatus').value = s.status || 'Active';
  document.getElementById('sfNotes').value = s.notes || '';
  document.getElementById('deleteStaffBtn').classList.remove('hidden');
  openModal('staffModal');
}

async function saveStaff() {
  const name = document.getElementById('sfName').value.trim();
  if (!name) { showToast('Full name is required.', 'error'); return; }

  const id = document.getElementById('editStaffId').value;
  const payload = {
    full_name: name,
    role: document.getElementById('sfRole').value.trim(),
    department: document.getElementById('sfDept').value.trim(),
    email: document.getElementById('sfEmail').value.trim(),
    phone: document.getElementById('sfPhone').value.trim(),
    hire_date: document.getElementById('sfHireDate').value,
    status: document.getElementById('sfStatus').value,
    notes: document.getElementById('sfNotes').value.trim(),
  };

  const btn = document.getElementById('saveStaffBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    if (id) {
      await apiPatch(`tables/staff/${id}`, payload);
      const idx = allStaff.findIndex(s => s.id === id);
      if (idx >= 0) allStaff[idx] = { ...allStaff[idx], ...payload };
      showToast('Staff member updated!', 'success');
    } else {
      const created = await apiPost('tables/staff', payload);
      allStaff.unshift(created);
      showToast('Staff member added!', 'success');
    }
    closeModal('staffModal');
    populateDeptFilter();
    applyFilters();
    renderStats();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save';
  }
}

async function deleteStaff() {
  const id = document.getElementById('editStaffId').value;
  const s = allStaff.find(x => x.id === id);
  if (!confirm(`Delete ${s?.full_name || 'this staff member'}? All their certifications will also be deleted.`)) return;
  try {
    await apiDelete(`tables/staff/${id}`);
    allStaff = allStaff.filter(x => x.id !== id);
    showToast('Staff member deleted.', 'warning');
    closeModal('staffModal');
    applyFilters();
    renderStats();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

// ── Staff Certs Viewer ─────────────────────────────────────────
function viewStaffCerts(staffId, staffName) {
  const certs = certsByStaff[staffId] || [];
  document.getElementById('staffCertModalTitle').innerHTML =
    `<i class="fas fa-certificate"></i> ${esc(staffName)} — Certifications`;

  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const list = document.getElementById('staffCertList');
  if (!certs.length) {
    list.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:1rem">No certifications on file.</p>`;
  } else {
    list.innerHTML = `<div class="table-scroll"><table class="data-table">
      <thead><tr><th>Type</th><th>Cert #</th><th>Expiry</th><th>Status</th><th>Document</th></tr></thead>
      <tbody>` +
      certs.map(c => {
        const days = daysLeft(c.expiry_date);
        const statusBadge = c.expiry_date <= today
          ? `<span class="cert-status-badge cert-badge-expired">Expired</span>`
          : c.expiry_date <= soon
            ? `<span class="cert-status-badge cert-badge-expiring">Expiring Soon</span>`
            : `<span class="cert-status-badge cert-badge-valid">Valid</span>`;
        const fileLink = c.file_key
          ? `<a href="/api/files/${esc(c.file_key)}" target="_blank" class="file-link"><i class="fas fa-file-alt"></i> ${esc(c.file_name || 'View')}</a>`
          : '—';
        return `<tr>
          <td><span class="cert-type-chip">${esc(c.cert_type_name)}</span></td>
          <td>${esc(c.cert_number || '—')}</td>
          <td>${fmtDate(c.expiry_date)} ${days !== null ? `<small style="color:var(--text-muted)">(${days < 0 ? Math.abs(days) + 'd ago' : days + 'd left'})</small>` : ''}</td>
          <td>${statusBadge}</td>
          <td>${fileLink}</td>
        </tr>`;
      }).join('') +
      `</tbody></table></div>`;
  }

  document.getElementById('goToCertBtn').href = `/certifications.html`;
  openModal('staffCertModal');
}
