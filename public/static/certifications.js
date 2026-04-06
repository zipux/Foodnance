/* ===== certifications.js ===== */

const PAGE_SIZE = 20;
let allCerts = [];
let allStaff = [];
let allTypes = [];
let filteredCerts = [];
let currentPage = 1;
let currentView = 'certifications';

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadStaff(), loadTypes(), loadCerts()]);
  renderStats();

  document.getElementById('certSearch').addEventListener('input', () => { currentPage = 1; applyFilters(); });
  document.getElementById('certStaffFilter').addEventListener('change', () => { currentPage = 1; applyFilters(); });
  document.getElementById('certTypeFilter').addEventListener('change', () => { currentPage = 1; applyFilters(); });

  document.getElementById('openAddCertBtn').addEventListener('click', openAddCert);
  document.getElementById('saveCertBtn').addEventListener('click', saveCert);
  document.getElementById('cancelCertModal').addEventListener('click', () => closeModal('certModal'));
  document.getElementById('closeCertModal').addEventListener('click', () => closeModal('certModal'));
  document.getElementById('deleteCertBtn').addEventListener('click', deleteCert);

  document.getElementById('openAddTypeBtn').addEventListener('click', openAddType);
  document.getElementById('saveTypeBtn').addEventListener('click', saveType);
  document.getElementById('cancelTypeModal').addEventListener('click', () => closeModal('typeModal'));
  document.getElementById('closeTypeModal').addEventListener('click', () => closeModal('typeModal'));
  document.getElementById('deleteTypeBtn').addEventListener('click', deleteType);

  // File upload
  const fileInput = document.getElementById('certFileInput');
  fileInput.addEventListener('change', handleFileSelect);
  const uploadArea = document.getElementById('certUploadArea');
  uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
  uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFileUpload(e.dataTransfer.files[0]);
  });

  // Auto-set expiry when cert type changes
  document.getElementById('certType').addEventListener('change', autoSetExpiry);
  document.getElementById('certIssueDate').addEventListener('change', autoSetExpiry);
});

function autoSetExpiry() {
  const typeId = document.getElementById('certType').value;
  const issueDate = document.getElementById('certIssueDate').value;
  if (!typeId || !issueDate) return;
  const type = allTypes.find(t => t.id === typeId);
  if (!type || !type.validity_months) return;
  const d = new Date(issueDate);
  d.setMonth(d.getMonth() + parseInt(type.validity_months));
  document.getElementById('certExpiryDate').value = d.toISOString().slice(0, 10);
}

async function loadStaff() {
  const data = await apiGet('tables/staff?limit=500');
  allStaff = (data.data || []).filter(s => s.status === 'Active' || s.status !== 'Inactive');
  const sel = document.getElementById('certStaff');
  const flt = document.getElementById('certStaffFilter');
  const opts = allStaff.map(s => `<option value="${esc(s.id)}">${esc(s.full_name)}</option>`).join('');
  sel.innerHTML = '<option value="">— Select staff —</option>' + opts;
  flt.innerHTML = '<option value="">All Staff</option>' + opts;
}

async function loadTypes() {
  const data = await apiGet('tables/certification_types?limit=500');
  allTypes = data.data || [];
  const sel = document.getElementById('certType');
  const flt = document.getElementById('certTypeFilter');
  const opts = allTypes.map(t =>
    `<option value="${esc(t.id)}">${esc(t.name)}${t.is_mandatory ? ' ★' : ''}</option>`
  ).join('');
  sel.innerHTML = '<option value="">— Select type —</option>' + opts;
  flt.innerHTML = '<option value="">All Types</option>' + opts;
  renderTypeTable();
}

async function loadCerts() {
  const data = await apiGet('tables/staff_certifications?limit=500');
  allCerts = data.data || [];
  applyFilters();
}

function renderStats() {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const total = allCerts.length;
  const valid = allCerts.filter(c => c.expiry_date > today).length;
  const expiring = allCerts.filter(c => c.expiry_date > today && c.expiry_date <= soon).length;
  const expired = allCerts.filter(c => c.expiry_date <= today).length;
  const staffWithCerts = new Set(allCerts.map(c => c.staff_id)).size;

  document.getElementById('certStats').innerHTML = `
    <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">Total Certifications</div></div>
    <div class="stat-card"><div class="stat-value" style="color:#059669">${valid}</div><div class="stat-label">Valid</div></div>
    <div class="stat-card"><div class="stat-value" style="color:#d97706">${expiring}</div><div class="stat-label">Expiring ≤ 30 days</div></div>
    <div class="stat-card"><div class="stat-value" style="color:#dc2626">${expired}</div><div class="stat-label">Expired</div></div>
    <div class="stat-card"><div class="stat-value">${staffWithCerts}</div><div class="stat-label">Staff with Certs</div></div>
    <div class="stat-card"><div class="stat-value">${allTypes.length}</div><div class="stat-label">Cert Types</div></div>
  `;
}

// ── View Switcher ───────────────────────────────────────────────
function switchView(view, btn) {
  currentView = view;
  document.querySelectorAll('.status-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  document.getElementById('certView').classList.add('hidden');
  document.getElementById('typesView').classList.add('hidden');

  if (view === 'types') {
    document.getElementById('typesView').classList.remove('hidden');
  } else {
    document.getElementById('certView').classList.remove('hidden');
    currentPage = 1;
    applyFilters(view);
  }
}

function applyFilters(viewOverride) {
  const view = viewOverride || currentView;
  const q = document.getElementById('certSearch').value.trim().toLowerCase();
  const staffId = document.getElementById('certStaffFilter').value;
  const typeId = document.getElementById('certTypeFilter').value;
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  filteredCerts = allCerts.filter(c => {
    if (staffId && c.staff_id !== staffId) return false;
    if (typeId && c.cert_type_id !== typeId) return false;
    if (view === 'expiring' && !(c.expiry_date > today && c.expiry_date <= soon)) return false;
    if (view === 'expired' && c.expiry_date > today) return false;
    if (q) {
      const hay = [c.staff_name, c.cert_type_name, c.cert_number, c.issuer].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filteredCerts.sort((a, b) => (a.expiry_date || '') < (b.expiry_date || '') ? -1 : 1);
  renderCertTable();
}

function renderCertTable() {
  const total = filteredCerts.length;
  const pages = Math.ceil(total / PAGE_SIZE) || 1;
  if (currentPage > pages) currentPage = pages;
  const slice = filteredCerts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const tbody = document.getElementById('certBody');
  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row"><i class="fas fa-inbox"></i> No certifications found.</td></tr>`;
  } else {
    tbody.innerHTML = slice.map(c => {
      const days = daysLeft(c.expiry_date);
      let statusCls = 'cert-badge-valid', statusTxt = 'Valid';
      if (c.expiry_date <= today) { statusCls = 'cert-badge-expired'; statusTxt = 'Expired'; }
      else if (c.expiry_date <= soon) { statusCls = 'cert-badge-expiring'; statusTxt = 'Expiring Soon'; }

      const fileLink = c.file_key
        ? `<a href="/api/files/${esc(c.file_key)}" target="_blank" class="file-link"><i class="fas fa-file-alt"></i> ${esc(c.file_name || 'View')}</a>`
        : '<span style="color:var(--text-muted)">—</span>';

      return `<tr>
        <td style="font-weight:600">${esc(c.staff_name)}</td>
        <td><span class="cert-type-chip">${esc(c.cert_type_name)}</span></td>
        <td>${esc(c.cert_number || '—')}</td>
        <td>${esc(c.issue_date || '—')}</td>
        <td>${esc(c.expiry_date || '—')}${days !== null ? `<br><small style="color:var(--text-muted)">${days < 0 ? Math.abs(days) + 'd overdue' : days + 'd left'}</small>` : ''}</td>
        <td><span class="cert-status-badge ${statusCls}">${statusTxt}</span></td>
        <td>${esc(c.issuer || '—')}</td>
        <td>${fileLink}</td>
        <td>
          <button class="btn btn-icon btn-secondary btn-sm" onclick="openEditCert('${esc(c.id)}')" title="Edit">
            <i class="fas fa-edit"></i>
          </button>
        </td>
      </tr>`;
    }).join('');
  }

  const pg = document.getElementById('certPagination');
  if (pages <= 1) { pg.innerHTML = ''; return; }
  pg.innerHTML = Array.from({ length: pages }, (_, i) =>
    `<button class="page-btn ${i + 1 === currentPage ? 'active' : ''}" onclick="goPage(${i + 1})">${i + 1}</button>`
  ).join('');
}

function goPage(p) { currentPage = p; renderCertTable(); }

// ── Cert Type Table ─────────────────────────────────────────────
function renderTypeTable() {
  const tbody = document.getElementById('typeBody');
  if (!allTypes.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row"><i class="fas fa-inbox"></i> No certification types yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = allTypes.map(t => `
    <tr>
      <td style="font-weight:600">${esc(t.name)}</td>
      <td>${esc(t.description || '—')}</td>
      <td>${t.validity_months} months</td>
      <td>${t.is_mandatory ? '<span class="badge badge-red">Mandatory</span>' : '<span class="badge badge-gray">Optional</span>'}</td>
      <td>
        <button class="btn btn-icon btn-secondary btn-sm" onclick="openEditType('${esc(t.id)}')" title="Edit">
          <i class="fas fa-edit"></i>
        </button>
      </td>
    </tr>`).join('');
}

// ── Cert Modal ──────────────────────────────────────────────────
function openAddCert() {
  document.getElementById('certModalTitle').innerHTML = '<i class="fas fa-plus"></i> Add Certification';
  document.getElementById('editCertId').value = '';
  document.getElementById('certStaff').value = '';
  document.getElementById('certType').value = '';
  document.getElementById('certNumber').value = '';
  document.getElementById('certIssuer').value = '';
  document.getElementById('certIssueDate').value = '';
  document.getElementById('certExpiryDate').value = '';
  document.getElementById('certNotes').value = '';
  document.getElementById('certFileKey').value = '';
  document.getElementById('certFileName').value = '';
  document.getElementById('certFilePreview').innerHTML = '';
  document.getElementById('deleteCertBtn').classList.add('hidden');
  openModal('certModal');
}

function openEditCert(id) {
  const c = allCerts.find(x => x.id === id);
  if (!c) return;
  document.getElementById('certModalTitle').innerHTML = '<i class="fas fa-edit"></i> Edit Certification';
  document.getElementById('editCertId').value = c.id;
  document.getElementById('certStaff').value = c.staff_id || '';
  document.getElementById('certType').value = c.cert_type_id || '';
  document.getElementById('certNumber').value = c.cert_number || '';
  document.getElementById('certIssuer').value = c.issuer || '';
  document.getElementById('certIssueDate').value = c.issue_date || '';
  document.getElementById('certExpiryDate').value = c.expiry_date || '';
  document.getElementById('certNotes').value = c.notes || '';
  document.getElementById('certFileKey').value = c.file_key || '';
  document.getElementById('certFileName').value = c.file_name || '';
  document.getElementById('certFilePreview').innerHTML = c.file_key
    ? `<a href="/api/files/${esc(c.file_key)}" target="_blank" class="file-link"><i class="fas fa-file-alt"></i> ${esc(c.file_name || 'Current file')}</a>`
    : '';
  document.getElementById('deleteCertBtn').classList.remove('hidden');
  openModal('certModal');
}

// ── File handling ───────────────────────────────────────────────
async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) await handleFileUpload(file);
}

async function handleFileUpload(file) {
  const preview = document.getElementById('certFilePreview');
  preview.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Uploading ${esc(file.name)}…`;
  try {
    const result = await apiUploadFile(file);
    document.getElementById('certFileKey').value = result.key;
    document.getElementById('certFileName').value = result.name;
    preview.innerHTML = `<i class="fas fa-check-circle" style="color:#059669"></i> <a href="${esc(result.url)}" target="_blank" class="file-link">${esc(result.name)}</a> uploaded`;
    showToast('File uploaded!', 'success');
  } catch (e) {
    preview.innerHTML = `<span style="color:#dc2626"><i class="fas fa-times"></i> Upload failed: ${esc(e.message)}</span>`;
    showToast('Upload failed: ' + e.message, 'error');
  }
}

async function saveCert() {
  const staffId = document.getElementById('certStaff').value;
  const typeId = document.getElementById('certType').value;
  const issueDate = document.getElementById('certIssueDate').value;
  const expiryDate = document.getElementById('certExpiryDate').value;

  if (!staffId) { showToast('Please select a staff member.', 'error'); return; }
  if (!typeId) { showToast('Please select a certification type.', 'error'); return; }
  if (!issueDate) { showToast('Issue date is required.', 'error'); return; }
  if (!expiryDate) { showToast('Expiry date is required.', 'error'); return; }

  const staff = allStaff.find(s => s.id === staffId);
  const type = allTypes.find(t => t.id === typeId);

  const id = document.getElementById('editCertId').value;
  const payload = {
    staff_id: staffId,
    cert_type_id: typeId,
    cert_type_name: type?.name || '',
    staff_name: staff?.full_name || '',
    issue_date: issueDate,
    expiry_date: expiryDate,
    issuer: document.getElementById('certIssuer').value.trim(),
    cert_number: document.getElementById('certNumber').value.trim(),
    file_key: document.getElementById('certFileKey').value,
    file_name: document.getElementById('certFileName').value,
    notes: document.getElementById('certNotes').value.trim(),
    status: expiryDate < new Date().toISOString().slice(0, 10) ? 'Expired' : 'Valid',
  };

  const btn = document.getElementById('saveCertBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    if (id) {
      await apiPatch(`tables/staff_certifications/${id}`, payload);
      const idx = allCerts.findIndex(c => c.id === id);
      if (idx >= 0) allCerts[idx] = { ...allCerts[idx], ...payload };
      showToast('Certification updated!', 'success');
    } else {
      const created = await apiPost('tables/staff_certifications', payload);
      allCerts.unshift(created);
      showToast('Certification added!', 'success');
    }
    closeModal('certModal');
    applyFilters();
    renderStats();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save';
  }
}

async function deleteCert() {
  const id = document.getElementById('editCertId').value;
  const c = allCerts.find(x => x.id === id);
  if (!confirm(`Delete certification for ${c?.staff_name || 'this staff member'}?`)) return;
  try {
    await apiDelete(`tables/staff_certifications/${id}`);
    allCerts = allCerts.filter(x => x.id !== id);
    showToast('Certification deleted.', 'warning');
    closeModal('certModal');
    applyFilters();
    renderStats();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

// ── Type Modal ──────────────────────────────────────────────────
function openAddType() {
  document.getElementById('typeModalTitle').innerHTML = '<i class="fas fa-tag"></i> Add Certification Type';
  document.getElementById('editTypeId').value = '';
  document.getElementById('typeName').value = '';
  document.getElementById('typeDesc').value = '';
  document.getElementById('typeValidity').value = '12';
  document.getElementById('typeMandatory').value = '0';
  document.getElementById('deleteTypeBtn').classList.add('hidden');
  openModal('typeModal');
}

function openEditType(id) {
  const t = allTypes.find(x => x.id === id);
  if (!t) return;
  document.getElementById('typeModalTitle').innerHTML = '<i class="fas fa-edit"></i> Edit Certification Type';
  document.getElementById('editTypeId').value = t.id;
  document.getElementById('typeName').value = t.name || '';
  document.getElementById('typeDesc').value = t.description || '';
  document.getElementById('typeValidity').value = t.validity_months || 12;
  document.getElementById('typeMandatory').value = t.is_mandatory ? '1' : '0';
  document.getElementById('deleteTypeBtn').classList.remove('hidden');
  openModal('typeModal');
}

async function saveType() {
  const name = document.getElementById('typeName').value.trim();
  if (!name) { showToast('Name is required.', 'error'); return; }

  const id = document.getElementById('editTypeId').value;
  const payload = {
    name,
    description: document.getElementById('typeDesc').value.trim(),
    validity_months: parseInt(document.getElementById('typeValidity').value) || 12,
    is_mandatory: parseInt(document.getElementById('typeMandatory').value),
  };

  const btn = document.getElementById('saveTypeBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

  try {
    if (id) {
      await apiPatch(`tables/certification_types/${id}`, payload);
      const idx = allTypes.findIndex(t => t.id === id);
      if (idx >= 0) allTypes[idx] = { ...allTypes[idx], ...payload };
      showToast('Type updated!', 'success');
    } else {
      const created = await apiPost('tables/certification_types', payload);
      allTypes.push(created);
      showToast('Type added!', 'success');
    }
    closeModal('typeModal');
    await loadTypes();
    renderStats();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save';
  }
}

async function deleteType() {
  const id = document.getElementById('editTypeId').value;
  const t = allTypes.find(x => x.id === id);
  if (!confirm(`Delete type "${t?.name}"?`)) return;
  try {
    await apiDelete(`tables/certification_types/${id}`);
    allTypes = allTypes.filter(x => x.id !== id);
    showToast('Type deleted.', 'warning');
    closeModal('typeModal');
    renderTypeTable();
    renderStats();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}
