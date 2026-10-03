/* ===== staff.js ===== */

const PAGE_SIZE = 20;
let allStaff = [];
let filtered = [];
let currentPage = 1;
let certsByStaff = {}; // staffId → [certs]
let certTypes = [];    // the organization's certification types (for the add form)
let viewingCertsFor = null;   // { id, name } of the staff member whose certificates window is open
const NEW_TYPE = '__new_type__';

document.addEventListener('DOMContentLoaded', async () => {
  await loadStaff();
  await loadCertsByStaff();
  // loadStaff() drew the table before the certificates arrived, so every row
  // read "None" and the expiry counts read 0 until something redrew it.
  applyFilters();
  renderStats();

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

  // Add certification — opened from a staff row or from that person's certificates window.
  document.getElementById('staffCertAddBtn').addEventListener('click', () => {
    if (!viewingCertsFor) return;
    closeModal('staffCertModal');
    openAddCert(viewingCertsFor.id, viewingCertsFor.name);
  });
  document.getElementById('saveAddCertBtn').addEventListener('click', saveAddCert);
  document.getElementById('cancelAddCertModal').addEventListener('click', () => closeModal('addCertModal'));
  document.getElementById('closeAddCertModal').addEventListener('click', () => closeModal('addCertModal'));
  document.getElementById('acType').addEventListener('change', onAddCertTypeChange);
  document.getElementById('acIssueDate').addEventListener('change', autoSetAddCertExpiry);
  const acArea = document.getElementById('acUploadArea'), acInput = document.getElementById('acFileInput');
  acArea.addEventListener('click', () => acInput.click());
  acInput.addEventListener('change', e => { if (e.target.files[0]) uploadAddCertFile(e.target.files[0]); });
  acArea.addEventListener('dragover', e => { e.preventDefault(); acArea.classList.add('dragover'); });
  acArea.addEventListener('dragleave', () => acArea.classList.remove('dragover'));
  acArea.addEventListener('drop', e => {
    e.preventDefault();
    acArea.classList.remove('dragover');
    if (e.dataTransfer.files[0]) uploadAddCertFile(e.dataTransfer.files[0]);
  });
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
          <button class="btn btn-icon btn-secondary btn-sm" onclick="viewStaffCerts('${esc(s.id)}', this.dataset.name)" data-name="${esc(s.full_name)}" title="View Certifications">
            ${certBadge}
          </button>
        </td>
        <td style="white-space:nowrap">
          <button class="btn btn-secondary btn-sm" onclick="openAddCert('${esc(s.id)}', this.dataset.name)" data-name="${esc(s.full_name)}" title="Add a certification and upload its document">
            <i class="fas fa-plus"></i> Add certification
          </button>
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
  viewingCertsFor = { id: staffId, name: staffName };
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

// ── Add certification (for one staff member) ───────────────────
// The same record the Certifications page creates, added from where the person
// already is: the staff member is fixed, and a type that doesn't exist yet can
// be typed in ("+ New type…") — a new account starts with no types at all, and
// the form can't be saved without one.
async function loadCertTypes() {
  const data = await apiGet('tables/certification_types?limit=500');
  certTypes = (data.data || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function fillAddCertTypes(selected) {
  document.getElementById('acType').innerHTML =
    '<option value="">— Select type —</option>' +
    certTypes.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('') +
    `<option value="${NEW_TYPE}">+ New type…</option>`;
  document.getElementById('acType').value = selected || '';
  onAddCertTypeChange();
}

function onAddCertTypeChange() {
  const isNew = document.getElementById('acType').value === NEW_TYPE;
  document.getElementById('acNewTypeGroup').classList.toggle('hidden', !isNew);
  if (isNew) document.getElementById('acNewType').focus();
  autoSetAddCertExpiry();
}

// Same convenience as the Certifications page: an existing type's validity
// fills in the expiry date from the issue date. It stays editable.
function autoSetAddCertExpiry() {
  const type = certTypes.find(t => t.id === document.getElementById('acType').value);
  const issueDate = document.getElementById('acIssueDate').value;
  if (!type || !type.validity_months || !issueDate) return;
  const d = new Date(issueDate);
  d.setMonth(d.getMonth() + parseInt(type.validity_months));
  document.getElementById('acExpiryDate').value = d.toISOString().slice(0, 10);
}

async function openAddCert(staffId, staffName) {
  document.getElementById('acStaffId').value = staffId;
  document.getElementById('addCertModalTitle').innerHTML =
    `<i class="fas fa-certificate"></i> Add certification — ${esc(staffName)}`;
  ['acNewType', 'acNumber', 'acIssuer', 'acIssueDate', 'acExpiryDate', 'acNotes', 'acFileKey', 'acFileName', 'acFileInput']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('acFilePreview').innerHTML = '';
  try {
    await loadCertTypes();
  } catch (e) {
    showToast('Could not load certification types: ' + e.message, 'error');
    return;
  }
  // No types yet: open straight on "new type" rather than an empty list.
  fillAddCertTypes(certTypes.length ? '' : NEW_TYPE);
  openModal('addCertModal');
  if (!certTypes.length) document.getElementById('acNewType').focus();
}

async function uploadAddCertFile(file) {
  const preview = document.getElementById('acFilePreview');
  preview.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Uploading ${esc(file.name)}…`;
  try {
    const result = await apiUploadFile(file);
    document.getElementById('acFileKey').value  = result.key;
    document.getElementById('acFileName').value = result.name;
    preview.innerHTML = `<i class="fas fa-check-circle" style="color:#059669"></i> <a href="${esc(result.url)}" target="_blank" class="file-link">${esc(result.name)}</a> uploaded`;
  } catch (e) {
    preview.innerHTML = `<span style="color:#dc2626"><i class="fas fa-times"></i> Upload failed: ${esc(e.message)}</span>`;
    showToast('Upload failed: ' + e.message, 'error');
  }
}

async function saveAddCert() {
  const staffId    = document.getElementById('acStaffId').value;
  const staff      = allStaff.find(s => s.id === staffId);
  const typeChoice = document.getElementById('acType').value;
  const newName    = document.getElementById('acNewType').value.trim();
  const issueDate  = document.getElementById('acIssueDate').value;
  const expiryDate = document.getElementById('acExpiryDate').value;

  if (!staff) { showToast('This staff member could not be found. Reload the page and try again.', 'error'); return; }
  if (!typeChoice) { showToast('Please select a certification type.', 'error'); return; }
  if (typeChoice === NEW_TYPE && !newName) { showToast('Enter a name for the new certification type.', 'error'); return; }
  if (!issueDate) { showToast('Issue date is required.', 'error'); return; }
  if (!expiryDate) { showToast('Expiry date is required.', 'error'); return; }

  const btn = document.getElementById('saveAddCertBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    let type = certTypes.find(t => t.id === typeChoice);
    if (typeChoice === NEW_TYPE) {
      // A name that already exists is that type, not a second one beside it.
      type = certTypes.find(t => (t.name || '').trim().toLowerCase() === newName.toLowerCase());
      if (!type) {
        // Same defaults the Certifications page's "Add Type" form starts with.
        type = await apiPost('tables/certification_types', {
          name: newName, description: '', validity_months: 12, is_mandatory: 0,
        });
        certTypes.push(type);
      }
    }
    const created = await apiPost('tables/staff_certifications', {
      staff_id:       staffId,
      cert_type_id:   type.id,
      cert_type_name: type.name || '',
      staff_name:     staff.full_name || '',
      issue_date:     issueDate,
      expiry_date:    expiryDate,
      issuer:         document.getElementById('acIssuer').value.trim(),
      cert_number:    document.getElementById('acNumber').value.trim(),
      file_key:       document.getElementById('acFileKey').value,
      file_name:      document.getElementById('acFileName').value,
      notes:          document.getElementById('acNotes').value.trim(),
      status:         expiryDate < new Date().toISOString().slice(0, 10) ? 'Expired' : 'Valid',
    });
    if (!certsByStaff[staffId]) certsByStaff[staffId] = [];
    certsByStaff[staffId].unshift(created);
    showToast('Certification added!', 'success');
    closeModal('addCertModal');
    applyFilters();
    renderStats();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save';
  }
}
