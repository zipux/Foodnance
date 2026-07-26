// ===== invoice.js — quick-save upload flow =====
// Pipeline per upload:
//   1. Preprocess images (quality check + enhance)  — reject if any fail
//   2. Upload first file to R2
//   3. Claude reads the document(s) directly and returns structured JSON
//   4. Run validation → collect warnings (totals, missing pages, "needs review", unknown units)
//   5. Apply known product-name mappings for the vendor
//   6. Cross-page invoice-number consistency check
//   7. Duplicate invoice-number check  → blocked if hit; confirm-modal if missing
//   8. Save the invoice as status="Action Required" with parsed_data JSON
//      — products, suppliers, line items are NOT written here; that happens in the
//      review modal on the Invoices page (Confirm & Save).

// ── PDF.js Worker ──────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

// ══════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════
let extractedRows   = [];          // line items mapped from GPT output
let originalGptNames = [];         // GPT names before mappings (used as mapping key)
let currentFileName = '';
let currentFileKey  = '';
let currentFileUrl  = '';
let currentPageKeys = [];   // R2 keys for every uploaded page (index 0 = page 1 = currentFileKey)
let currentUploadFailed = false; // true when the primary image failed to store in R2

let currentTaxGst        = 0;
let currentTaxPst        = 0;
let currentDelivery      = 0;
let currentFuelSurcharge = 0;
let currentDeposit       = 0;
let currentCredit        = 0;
let currentOtherCost     = 0;
let currentOtherDesc     = '';

// Vendor / invoice meta from GPT
let currentVendor        = '';
let currentInvoiceNumber = '';
let currentInvoiceDate   = '';
let currentInvoiceTotal  = 0;

// Multi-file staging
let stagedFiles   = [];   // { file, id, thumbUrl, type: 'pdf'|'img' }
let batchType     = null; // 'pdf' | 'img'
let dragSrcIndex  = null;

// Cross-page consistency
let pageInvoiceNumbers = [];

// Claude raw response (for diagnostics)
let gptRawPages = [];

// Validation warnings collected during processing — saved with parsed_data
let invoiceWarnings = [];   // [{ id, message, severity }]

// AI status
let _aiConfigured = null;

// ── DOM Refs ───────────────────────────────────────────────────
const dropZone      = () => document.getElementById('dropZone');
const fileInput     = () => document.getElementById('fileInput');
const cameraInput   = () => document.getElementById('cameraInput');
const parseProgress = () => document.getElementById('parseProgress');
const progressBar   = () => document.getElementById('progressBar');
const parseStatus   = () => document.getElementById('parseStatus');
const savedBanner   = () => document.getElementById('savedBanner');

// ══════════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('dropZone')) return;

  checkAiStatus();

  const dz = dropZone();
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('dragging'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragging'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('dragging');
    if (e.dataTransfer.files.length) addFilesToStage([...e.dataTransfer.files]);
  });

  fileInput().addEventListener('change', e => {
    if (e.target.files.length) addFilesToStage([...e.target.files]);
    e.target.value = '';
  });

  cameraInput().addEventListener('change', e => {
    if (e.target.files.length) addFilesToStage([...e.target.files]);
    e.target.value = '';
  });

  document.getElementById('clearBatchBtn').addEventListener('click', clearBatch);
  document.getElementById('clearBatchLink').addEventListener('click', e => { e.preventDefault(); clearBatch(); });
  document.getElementById('submitBatchBtn').addEventListener('click', submitBatch);

  const uploadAnother = document.getElementById('uploadAnotherBtn');
  if (uploadAnother) uploadAnother.addEventListener('click', () => {
    hideSavedBanner();
    clearBatch();
  });
});

// ══════════════════════════════════════════════════════════════
// MULTI-FILE STAGING
// ══════════════════════════════════════════════════════════════
function fileCategory(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['png','jpg','jpeg','webp'].includes(ext)) return 'img';
  // Camera capture on some browsers reports no extension; fall back to mime type
  if (file.type && file.type.startsWith('image/')) return 'img';
  if (file.type === 'application/pdf') return 'pdf';
  return 'other';
}

async function addFilesToStage(files) {
  hideSavedBanner();

  const supported = files.filter(f => ['pdf','img'].includes(fileCategory(f)));
  if (!supported.length) {
    showToast('Only PDF and JPG/PNG files are supported.', 'error');
    return;
  }
  if (supported.length < files.length) {
    showToast('Some files were skipped (only PDF and JPG/PNG are supported).', 'warning');
  }

  const newTypes = [...new Set(supported.map(fileCategory))];
  if (newTypes.length > 1) {
    showToast('Please add only PDF files OR only image files — not a mix.', 'error');
    showTypeMismatchWarn(batchType || newTypes[0], newTypes.find(t => t !== (batchType || newTypes[0])));
    return;
  }
  const newType = newTypes[0];
  if (batchType && batchType !== newType) {
    showTypeMismatchWarn(batchType, newType);
    return;
  }
  if (!batchType) batchType = newType;
  document.getElementById('typeMismatchWarn').style.display = 'none';

  for (const file of supported) {
    const id = 'sf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const thumbUrl = newType === 'img' ? await makeImageThumb(file) : null;
    stagedFiles.push({ file, id, thumbUrl, type: newType });
  }

  renderStagedList();
}

function showTypeMismatchWarn(existingType, attemptedType) {
  const typeLabel = t => t === 'pdf' ? 'PDF' : 'image (JPG/PNG)';
  document.getElementById('existingTypeLabel').textContent = typeLabel(existingType);
  document.getElementById('allowedTypeLabel').textContent  = typeLabel(existingType);
  document.getElementById('typeMismatchWarn').style.display = 'block';
}

function clearBatch() {
  stagedFiles  = [];
  batchType    = null;
  pageInvoiceNumbers = [];
  originalGptNames   = [];
  document.getElementById('fileStage').classList.add('hidden');
  document.getElementById('typeMismatchWarn').style.display = 'none';
  document.getElementById('submitBar').style.display = 'none';
  extractedRows = [];
  gptRawPages   = [];
  invoiceWarnings = [];
  currentTaxGst = 0; currentTaxPst = 0; currentDelivery = 0;
  currentFuelSurcharge = 0; currentDeposit = 0;
  currentCredit = 0; currentOtherCost = 0; currentOtherDesc = '';
  currentVendor = ''; currentInvoiceNumber = ''; currentInvoiceDate = '';
  currentInvoiceTotal = 0;
  currentFileName = ''; currentFileKey = ''; currentFileUrl = ''; currentPageKeys = []; currentUploadFailed = false;
  removeBlocker('parseBlocker');
  removeBlocker('qualityBlocker');
}

function makeImageThumb(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function renderStagedList() {
  const stage     = document.getElementById('fileStage');
  const list      = document.getElementById('stagedList');
  const badge     = document.getElementById('fileTypeBadge');
  const submitBar = document.getElementById('submitBar');

  if (!stagedFiles.length) { clearBatch(); return; }
  stage.classList.remove('hidden');

  if (batchType === 'pdf') {
    badge.className = 'file-type-badge pdf';
    badge.innerHTML = '<i class="fas fa-file-pdf"></i> PDF batch';
  } else {
    badge.className = 'file-type-badge img';
    badge.innerHTML = '<i class="fas fa-image"></i> Image batch';
  }

  list.innerHTML = '';
  stagedFiles.forEach((sf, idx) => {
    const item = document.createElement('div');
    item.className = 'staged-item';
    item.dataset.index = idx;
    item.draggable = true;

    const thumbHtml = sf.thumbUrl
      ? `<img src="${sf.thumbUrl}" class="file-thumb" alt="thumb" />`
      : `<div class="file-thumb pdf-thumb"><i class="fas fa-file-pdf"></i></div>`;

    const sizeKb = (sf.file.size / 1024).toFixed(0);
    const pageNum = idx + 1;

    item.innerHTML = `
      <span class="drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
      ${thumbHtml}
      <div class="file-info">
        <div class="file-name" title="${esc(sf.file.name)}">${esc(sf.file.name || 'photo.jpg')}</div>
        <div class="file-meta">${sizeKb} KB</div>
      </div>
      <span class="page-label">Page ${pageNum}</span>
      <button class="remove-btn" data-id="${sf.id}" title="Remove this file">
        <i class="fas fa-times"></i>
      </button>
    `;

    item.addEventListener('dragstart', e => {
      dragSrcIndex = idx;
      item.classList.add('being-dragged');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('being-dragged');
      list.querySelectorAll('.staged-item').forEach(el => el.classList.remove('dragging-over'));
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.querySelectorAll('.staged-item').forEach(el => el.classList.remove('dragging-over'));
      item.classList.add('dragging-over');
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('dragging-over');
      if (dragSrcIndex === null || dragSrcIndex === idx) return;
      const moved = stagedFiles.splice(dragSrcIndex, 1)[0];
      stagedFiles.splice(idx, 0, moved);
      dragSrcIndex = null;
      renderStagedList();
    });

    item.querySelector('.remove-btn').addEventListener('click', () => {
      stagedFiles = stagedFiles.filter(s => s.id !== sf.id);
      if (!stagedFiles.length) batchType = null;
      renderStagedList();
    });

    list.appendChild(item);
  });

  const count = stagedFiles.length;
  const noun  = batchType === 'pdf' ? (count === 1 ? 'PDF' : 'PDFs') : (count === 1 ? 'image' : 'images');
  document.getElementById('submitInfoText').textContent =
    `${count} ${noun} ready — ${count === 1 ? 'single page' : count + ' pages will be merged into one invoice'}`;
  submitBar.style.display = 'flex';
}

// Image preprocessing (quality gate, resize, deskew, compress) now lives in
// the shared /static/image-preproc.js so the invoice-detail "add page" path can
// reuse it. PREPROC and preprocessImage() come from there.

async function runPreprocessingPipeline() {
  const imgIndices = stagedFiles
    .map((sf, i) => ({ sf, i }))
    .filter(({ sf }) => sf.type === 'img');
  if (!imgIndices.length) return true;

  const total = imgIndices.length;
  const rejections = [];

  for (let j = 0; j < total; j++) {
    const { sf, i } = imgIndices[j];
    showProgress(
      Math.round((j / total) * 25),
      `Checking image quality: page ${j + 1}/${total}…`
    );

    const result = await preprocessImage(sf.file);

    if (result.rejected) {
      rejections.push({ pageNum: j + 1, fileName: sf.file.name, reason: result.reason });
      continue;
    }

    stagedFiles[i].file = result.file;

    const reader = new FileReader();
    reader.onload = e => { stagedFiles[i].thumbUrl = e.target.result; };
    reader.readAsDataURL(result.file);
  }

  if (rejections.length) {
    showQualityBlocker(rejections);
    return false;
  }
  return true;
}

function showQualityBlocker(rejections) {
  removeBlocker('qualityBlocker');
  const blocker = document.createElement('div');
  blocker.id = 'qualityBlocker';
  blocker.style.cssText = `
    margin-top: 1.25rem;
    padding: 1.1rem 1.25rem;
    background: #fef2f2;
    border: 2px solid #ef4444;
    border-radius: 10px;
    color: #991b1b;
    font-size: .92rem;
    line-height: 1.6;
  `;
  const list = rejections.map(r =>
    `<li><strong>Page ${r.pageNum} — ${esc(r.fileName)}</strong><br>${esc(r.reason)}</li>`
  ).join('');
  blocker.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:.75rem">
      <i class="fas fa-exclamation-circle" style="font-size:1.3rem;margin-top:.1rem;flex-shrink:0"></i>
      <div>
        <strong style="display:block;font-size:1rem;margin-bottom:.5rem">
          ${rejections.length === 1 ? '1 page' : rejections.length + ' pages'} failed the image quality check
        </strong>
        <p style="margin:0 0 .6rem">This image is too low quality. Please re-scan or re-photograph the invoice.</p>
        <ul style="margin:.4rem 0;padding-left:1.2rem">${list}</ul>
        <p style="margin:.6rem 0 0;font-size:.85rem;color:#b91c1c">
          Remove the affected file(s) from the list above and replace them, then submit again.
        </p>
      </div>
    </div>
  `;
  const uploadCard = document.querySelector('.upload-card');
  if (uploadCard?.parentNode) uploadCard.parentNode.insertBefore(blocker, uploadCard.nextSibling);

  hideProgress();
  resetSubmitButton();
}

function removeBlocker(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function resetSubmitButton() {
  const btn = document.getElementById('submitBatchBtn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-magic"></i> Upload &amp; Save';
  }
}

// ══════════════════════════════════════════════════════════════
// SUBMIT — runs the full pipeline
// ══════════════════════════════════════════════════════════════
async function submitBatch() {
  if (!stagedFiles.length) return;

  const btn = document.getElementById('submitBatchBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading…';

  // Reset per-run state
  extractedRows = [];
  gptRawPages   = [];
  invoiceWarnings = [];
  originalGptNames = [];
  pageInvoiceNumbers = [];
  currentVendor = ''; currentInvoiceNumber = ''; currentInvoiceDate = '';
  currentInvoiceTotal = 0;
  currentTaxGst = 0; currentTaxPst = 0; currentDelivery = 0;
  currentFuelSurcharge = 0; currentDeposit = 0;
  currentCredit = 0; currentOtherCost = 0; currentOtherDesc = '';
  currentFileName = ''; currentFileKey = ''; currentFileUrl = ''; currentPageKeys = []; currentUploadFailed = false;
  removeBlocker('parseBlocker');
  removeBlocker('qualityBlocker');
  removeBlocker('uploadBlocker');
  hideSavedBanner();

  try {
    showProgress(0, 'Checking image quality…');
    const preprocOk = await runPreprocessingPipeline();
    if (!preprocOk) {
      // runPreprocessingPipeline already showed the error panel + reset button
      return;
    }

    if (batchType === 'pdf') {
      await processPDFBatch();
    } else {
      await processImageBatch();
    }
  } catch (err) {
    console.error('Batch processing error:', err);
    showToast('Processing error: ' + err.message, 'error');
    hideProgress();
    resetSubmitButton();
  }
}

// Upload a single file to R2 with one retry, to ride out transient hiccups.
async function _uploadWithRetry(file) {
  try {
    return await apiUploadFile(file);
  } catch (firstErr) {
    console.warn('R2 upload failed, retrying once:', firstErr.message);
    return await apiUploadFile(file);  // second attempt; throws if it also fails
  }
}

// Upload every staged file to R2. files[0] becomes the primary attached file
// (currentFileKey); all successfully-uploaded keys are collected in
// currentPageKeys so the review modal can display every page, not just page 1.
// Returns true only if EVERY page uploaded. If any page fails (after a retry),
// it returns false and the caller hard-stops the pipeline — we never save an
// invoice with a missing image; the user must retry the upload.
async function uploadAllPages(files) {
  currentPageKeys = [];
  currentFileName = files[0].name;
  currentUploadFailed = false;
  for (let i = 0; i < files.length; i++) {
    try {
      const uploaded = await _uploadWithRetry(files[i]);
      currentPageKeys.push(uploaded.key);
      if (i === 0) {
        currentFileKey = uploaded.key;
        currentFileUrl = uploaded.url;
      }
    } catch (upErr) {
      console.warn(`R2 upload failed for page ${i + 1}:`, upErr.message);
      currentUploadFailed = true;
      return false;  // hard-stop: don't parse/save an invoice with a missing image
    }
  }
  return true;
}

// ── PDF batch ─────────────────────────────────────────────────
async function processPDFBatch() {
  const files = stagedFiles.map(s => s.file);
  const total = files.length;

  showProgress(28, `Uploading ${total} PDF${total > 1 ? 's' : ''}…`);

  // Upload every file to R2. files[0] is the primary attached file; the rest
  // are stored as additional pages so the review modal can show them all.
  // Hard-stop if any page fails — don't parse/save an invoice with no image.
  if (!(await uploadAllPages(files))) { hideProgress(); showUploadBlocker(); return; }

  if (!_aiConfigured) {
    hideProgress();
    showParseBlocker('Claude is not configured on this server. Please add ANTHROPIC_API_KEY to the server environment.');
    return;
  }

  // Per-file invoice-number detection from PDF.js text (used for cross-page consistency)
  for (let fi = 0; fi < files.length; fi++) {
    const ab  = await files[fi].arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    let allText = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc   = await page.getTextContent();
      tc.items.forEach(it => { if (it.str.trim()) allText += it.str + ' '; });
    }
    const invNumMatch = allText.match(/(?:invoice\s*(?:no|num|number|#)?[:.\s]*)([\w\-\/]{3,20})/i);
    pageInvoiceNumbers.push(invNumMatch ? invNumMatch[1].trim() : '');
  }

  showProgress(72, 'Reading invoice with Claude…');

  let aiResult = null;
  try {
    const { result, rawText } = await callClaudeParse(files);
    gptRawPages.push({ pageNumber: 1, fileName: files[0].name, rawText: rawText || '' });
    aiResult = result;
    extractedRows = mapAiResult(result, files[0].name);
  } catch (aiErr) {
    hideProgress();
    showToast('Claude parsing failed: ' + aiErr.message, 'error');
    resetSubmitButton();
    return;
  }

  // Apply mappings + run validation
  if (currentVendor) {
    try { await applyProductMappings(currentVendor); } catch (_) {}
  }
  runValidation(aiResult, aiResult.page_note || '', files.length);
  await collectUnknownUnitWarnings();

  showProgress(94, 'Checking for duplicates…');
  await checkInvoiceNumberConsistency(() => checkDuplicateInvoiceNumber(saveQuickInvoice));
}

// ── Image batch ──────────────────────────────────────────────
async function processImageBatch() {
  const files = stagedFiles.map(s => s.file);
  const total = files.length;

  if (!_aiConfigured) {
    hideProgress();
    showParseBlocker('Claude is not configured on this server. Please add ANTHROPIC_API_KEY to the server environment.');
    return;
  }

  showProgress(28, `Uploading ${total} image${total > 1 ? 's' : ''}…`);
  // Hard-stop if any page fails — don't parse/save an invoice with no image.
  if (!(await uploadAllPages(files))) { hideProgress(); showUploadBlocker(); return; }

  showProgress(70, 'Reading invoice with Claude…');

  let aiResult = null;
  try {
    const { result, rawText } = await callClaudeParse(files);
    gptRawPages.push({ pageNumber: 1, fileName: files[0].name, rawText: rawText || '' });
    pageInvoiceNumbers.push(result.invoice_number || '');
    aiResult = result;
    extractedRows = mapAiResult(result, files[0].name);
  } catch (aiErr) {
    hideProgress();
    showToast('Claude parsing failed: ' + aiErr.message, 'error');
    resetSubmitButton();
    return;
  }

  if (currentVendor) {
    try { await applyProductMappings(currentVendor); } catch (_) {}
  }
  runValidation(aiResult, aiResult.page_note || '', files.length);
  await collectUnknownUnitWarnings();

  showProgress(94, 'Checking for duplicates…');
  await checkInvoiceNumberConsistency(() => checkDuplicateInvoiceNumber(saveQuickInvoice));
}

// ══════════════════════════════════════════════════════════════
// CROSS-PAGE INVOICE NUMBER CHECK
// ══════════════════════════════════════════════════════════════
function checkInvoiceNumberConsistency(proceedFn) {
  const nums = pageInvoiceNumbers.filter(n => n && n.trim());
  if (nums.length < 2) return Promise.resolve(proceedFn());

  const first = nums[0].trim().toLowerCase();
  const mismatch = nums.some(n => n.trim().toLowerCase() !== first);
  if (!mismatch) return Promise.resolve(proceedFn());

  const details = pageInvoiceNumbers.map((n, i) =>
    `<div>Page ${i + 1}: <strong>${n ? esc(n) : '<em>not detected</em>'}</strong></div>`
  ).join('');
  document.getElementById('invNumWarnDetails').innerHTML = details;

  document.getElementById('ignoreInvNumWarnBtn').onclick = () => {
    closeModal('invNumWarnModal');
    proceedFn();
  };
  hideProgress();
  openModal('invNumWarnModal');
  return Promise.resolve();
}

// ══════════════════════════════════════════════════════════════
// DUPLICATE INVOICE NUMBER CHECK
// ══════════════════════════════════════════════════════════════
async function checkDuplicateInvoiceNumber(proceedFn) {
  const invoiceNumber = (currentInvoiceNumber || '').trim();

  if (!invoiceNumber) {
    // No invoice number found — show confirmation modal
    hideProgress();
    const cancelBtn  = document.getElementById('cancelNoInvNumBtn');
    const proceedBtn = document.getElementById('proceedNoInvNumBtn');
    const closeBtn   = document.getElementById('closeNoInvNumModal');

    const dismiss = () => { closeModal('noInvNumModal'); resetSubmitButton(); };
    const proceed = () => { closeModal('noInvNumModal'); proceedFn(); };

    cancelBtn.onclick  = dismiss;
    closeBtn.onclick   = dismiss;
    proceedBtn.onclick = proceed;

    openModal('noInvNumModal');
    return;
  }

  // Check DB for duplicates — block if found
  try {
    const data = await apiGet(`tables/invoices?invoice_number=${encodeURIComponent(invoiceNumber)}`);
    if (data.data && data.data.length > 0) {
      hideProgress();
      document.getElementById('dupInvNumMsg').textContent =
        `Invoice #${invoiceNumber} already exists in the system. Upload cancelled.`;
      openModal('dupInvNumModal');
      resetSubmitButton();
      return;
    }
  } catch (e) {
    console.warn('Duplicate check failed:', e.message);
    // On network error, allow proceeding rather than blocking
  }

  proceedFn();
}

// ══════════════════════════════════════════════════════════════
// SAVE — quick-save flow
// Writes to invoices table only. parsed_data carries everything
// the review modal will need to confirm later.
// ══════════════════════════════════════════════════════════════
async function saveQuickInvoice() {
  showProgress(98, 'Saving as Action Required…');

  const today = new Date().toISOString().slice(0, 10);

  // Build the parsed_data payload — single source of truth for the review modal.
  const parsedData = {
    version: 1,
    parsed_at: new Date().toISOString(),
    vendor:         currentVendor,
    invoice_number: currentInvoiceNumber,
    invoice_date:   currentInvoiceDate,
    total:          currentInvoiceTotal,
    tax_gst:        currentTaxGst,
    tax_pst:        currentTaxPst,
    delivery:       currentDelivery,
    fuel_surcharge: currentFuelSurcharge,
    deposit:        currentDeposit,
    credit:         currentCredit,
    other_cost:     currentOtherCost,
    other_desc:     currentOtherDesc,
    items: extractedRows.map((r, idx) => ({
      name:        r.name        || '',
      brand:       r.brand       || '',
      sku:         r.sku         || '',
      pack_size:   r.pack_size   || '',
      qty:         parseFloat(r.qty)        || 1,
      unit_price:  parseFloat(r.unit_price) || 0,
      cost:        parseFloat(r.cost)       || 0,
      invoice_ref: r.invoice_ref || '',
      original_ocr: originalGptNames[idx] || r._original_ocr || '',
      auto_mapped: !!r._auto_mapped,
    })),
    warnings: invoiceWarnings.slice(),
    file_name: currentFileName || '',
    // All uploaded page images (index 0 = page 1 = file_key). Lets the review
    // modal show every page of a multi-page invoice, not just the primary file.
    pages: currentPageKeys.slice(),
  };

  let savedInvoiceId = null;
  try {
    const payload = {
      vendor:          currentVendor          || '',
      invoice_number:  currentInvoiceNumber   || '',
      invoice_date:    currentInvoiceDate     || today,
      upload_date:     today,
      total:           parseFloat(currentInvoiceTotal) || 0,
      status:          'Action Required',
      payment_account: 'A/P',
      file_name:       currentFileName || '',
      file_key:        currentFileKey  || '',
      file_url:        currentFileUrl  || (currentFileKey ? `/api/files/${currentFileKey}` : ''),
      notes:           '',
      tax_gst:         currentTaxGst        || 0,
      tax_pst:         currentTaxPst        || 0,
      delivery:        currentDelivery      || 0,
      fuel_surcharge:  currentFuelSurcharge || 0,
      deposit:         currentDeposit       || 0,
      credit:          currentCredit        || 0,
      other_cost:      currentOtherCost     || 0,
      other_desc:      currentOtherDesc     || '',
      parsed_data:     JSON.stringify(parsedData),
    };
    const saved = await apiPost('tables/invoices', payload);
    savedInvoiceId = saved.id || null;
  } catch (e) {
    hideProgress();
    showToast('Save failed: ' + e.message, 'error');
    resetSubmitButton();
    return;
  }

  showProgress(100, 'Saved!');
  hideProgress();
  showSavedBanner(parsedData, savedInvoiceId);

  // Reset the staging area so the user can upload another invoice
  stagedFiles = [];
  batchType = null;
  document.getElementById('fileStage').classList.add('hidden');
  document.getElementById('submitBar').style.display = 'none';
  resetSubmitButton();
}

function showSavedBanner(parsedData, invoiceId) {
  const banner = savedBanner();
  if (!banner) return;
  const titleEl = document.getElementById('savedTitleText');
  const msgEl   = document.getElementById('savedMessage');
  const invNum  = parsedData.invoice_number ? `#${parsedData.invoice_number}` : '';
  const vendor  = parsedData.vendor ? ` from ${parsedData.vendor}` : '';
  const items   = parsedData.items?.length || 0;
  const warns   = parsedData.warnings?.length || 0;

  titleEl.textContent = `Saved! Invoice ${invNum}${vendor} is in your Action Required queue.`;
  let msg = `${items} line item${items === 1 ? '' : 's'} parsed.`;
  if (warns) msg += ` ${warns} warning${warns === 1 ? '' : 's'} flagged for review.`;
  msg += ' Open the invoice from the Invoices page to review and confirm.';
  msgEl.textContent = msg;

  const viewLink = banner.querySelector('a[href*="invoices"]');
  if (viewLink && invoiceId) viewLink.href = `/invoices.html?open=${encodeURIComponent(invoiceId)}`;

  banner.style.display = 'block';
}

function hideSavedBanner() {
  const banner = savedBanner();
  if (banner) banner.style.display = 'none';
}

// ══════════════════════════════════════════════════════════════
// AI STATUS
// ══════════════════════════════════════════════════════════════
async function checkAiStatus() {
  try {
    const data = await apiGet('ai/status');
    _aiConfigured = !!data.configured;
  } catch (_) {
    _aiConfigured = false;
  }
  const el = document.getElementById('apiKeyStatus');
  if (!el) return;
  if (_aiConfigured) {
    el.innerHTML = '<i class="fas fa-check-circle" style="color:#16a34a"></i> AI ready';
    el.style.color = '#16a34a';
  } else {
    el.innerHTML = '<i class="fas fa-exclamation-circle" style="color:#d97706"></i> No Claude key on server';
    el.style.color = '#d97706';
  }
}

function showParseBlocker(message) {
  removeBlocker('parseBlocker');
  const blocker = document.createElement('div');
  blocker.id = 'parseBlocker';
  blocker.style.cssText = `
    margin-top: 1.25rem;
    padding: 1.1rem 1.25rem;
    background: #fef2f2;
    border: 2px solid #ef4444;
    border-radius: 10px;
    color: #991b1b;
    font-size: .92rem;
    line-height: 1.6;
  `;
  blocker.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:.75rem">
      <i class="fas fa-exclamation-circle" style="font-size:1.3rem;margin-top:.1rem;flex-shrink:0"></i>
      <div>
        <strong style="display:block;font-size:1rem;margin-bottom:.4rem">Invoice Reading Failed — Processing Stopped</strong>
        <pre style="white-space:pre-wrap;font-family:inherit;margin:0">${esc(message)}</pre>
      </div>
    </div>
  `;
  const uploadCard = document.querySelector('.upload-card');
  if (uploadCard?.parentNode) uploadCard.parentNode.insertBefore(blocker, uploadCard.nextSibling);
  showToast('Invoice reading failed — see details on screen.', 'error');
  resetSubmitButton();
}

// Shown when a page image fails to upload to storage. The pipeline stops before
// parsing/saving so nothing is written; the user must retry. A Retry button
// re-runs the whole submit (the staged files are still there).
function showUploadBlocker() {
  removeBlocker('parseBlocker');
  removeBlocker('uploadBlocker');
  const blocker = document.createElement('div');
  blocker.id = 'uploadBlocker';
  blocker.style.cssText = `
    margin-top: 1.25rem;
    padding: 1.1rem 1.25rem;
    background: #fef2f2;
    border: 2px solid #ef4444;
    border-radius: 10px;
    color: #991b1b;
    font-size: .92rem;
    line-height: 1.6;
  `;
  blocker.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:.75rem">
      <i class="fas fa-cloud-arrow-up" style="font-size:1.3rem;margin-top:.1rem;flex-shrink:0"></i>
      <div style="flex:1">
        <strong style="display:block;font-size:1rem;margin-bottom:.4rem">Image Upload Failed — Nothing Saved</strong>
        <div>The invoice image couldn't be saved to storage (even after a retry), so processing was stopped and nothing was saved. Check your connection and try again.</div>
        <button class="btn btn-primary btn-sm" id="uploadRetryBtn" style="margin-top:.7rem">
          <i class="fas fa-rotate-right"></i> Retry upload
        </button>
      </div>
    </div>
  `;
  const uploadCard = document.querySelector('.upload-card');
  if (uploadCard?.parentNode) uploadCard.parentNode.insertBefore(blocker, uploadCard.nextSibling);
  document.getElementById('uploadRetryBtn').addEventListener('click', () => {
    removeBlocker('uploadBlocker');
    submitBatch();
  });
  showToast('Image upload failed — nothing was saved. Retry when ready.', 'error');
  resetSubmitButton();
}

// ══════════════════════════════════════════════════════════════
// CLAUDE CALL — send the raw document(s) for direct reading
// ══════════════════════════════════════════════════════════════
async function callClaudeParse(files) {
  if (!_aiConfigured) throw new Error('Claude API key is not configured on the server.');
  const formData = new FormData();
  for (const file of files) formData.append('file', file);
  const response = await fetch('/api/ai/parse-invoice', { method: 'POST', body: formData });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || `Server error ${response.status}`);
  return { result: data.result, rawText: data.rawText || JSON.stringify(data.result, null, 2) };
}

// ══════════════════════════════════════════════════════════════
// MAP CLAUDE RESULT → state + extractedRows
// ══════════════════════════════════════════════════════════════
function mapAiResult(result, fileName) {
  const ref = baseName(fileName);

  currentVendor          = result.vendor          || '';
  currentInvoiceNumber   = result.invoice_number  || '';
  currentInvoiceDate     = result.invoice_date    || '';
  currentInvoiceTotal    = parseFloat(result.total) || 0;

  currentTaxGst        = parseFloat(result.tax_gst)        || 0;
  currentTaxPst        = parseFloat(result.tax_pst)        || 0;
  currentDelivery      = parseFloat(result.delivery)       || 0;
  currentFuelSurcharge = parseFloat(result.fuel_surcharge) || 0;
  currentDeposit       = parseFloat(result.deposit)        || 0;
  currentCredit        = parseFloat(result.credit)         || 0;
  currentOtherCost     = parseFloat(result.other_cost)     || 0;
  currentOtherDesc     = result.other_desc || '';

  const items = result.items || [];
  originalGptNames = items.map(it => it.name || '');


  return items.map(it => ({
    name:           it.name           || '',
    brand:          it.brand          || '',
    sku:            it.sku            || '',
    pack_size:      it.pack_size      || '',
    qty:            parseFloat(it.qty) || 1,
    unit_price:     parseFloat(it.unit_price) || 0,
    cost:           parseFloat(it.cost) || 0,
    invoice_ref:    ref,
    _original_ocr:  it.original_ocr   || '',
    _auto_mapped:   false,
  }));
}

// ══════════════════════════════════════════════════════════════
// PRODUCT MAPPING — auto-replace extracted names with learned corrections
// ══════════════════════════════════════════════════════════════
function extractMappingKey(sku, description) {
  if (sku && sku.trim()) return sku.trim().toLowerCase();
  if (description && description.trim()) return description.trim().toLowerCase();
  return '';
}

function vendorNamesMatch(storedVendor, currentVendorName) {
  const a = (storedVendor || '').toLowerCase().trim();
  const b = (currentVendorName || '').toLowerCase().trim();
  if (a === b) return true;
  const aWords = a.split(/\s+/).filter(w => w.length >= 3);
  const bWords = b.split(/\s+/).filter(w => w.length >= 3);
  return aWords.some(w => b.includes(w)) || bWords.some(w => a.includes(w));
}

async function applyProductMappings(vendor) {
  if (!vendor || !vendor.trim()) return;
  try {
    const data = await apiGet('product-mappings');
    const all  = data.data || [];
    if (!all.length) return;
    const mappings = all.filter(m => vendorNamesMatch(m.vendor_name, vendor));
    if (!mappings.length) return;

    const lookup = {};
    mappings.forEach(m => {
      const key = (m.raw_ocr_text || '').toLowerCase().trim();
      if (key) lookup[key] = m;
    });

    extractedRows.forEach((row, idx) => {
      const rowKey = extractMappingKey(row.sku, originalGptNames[idx] || row.name);
      const match = rowKey ? lookup[rowKey] : null;
      if (match) {
        row.name      = match.corrected_name;
        row.brand     = match.corrected_brand     || row.brand;
        row.sku       = match.corrected_sku       || row.sku;
        row.pack_size = match.corrected_pack_size || row.pack_size;
        row._auto_mapped = true;
      }
    });
  } catch (e) {
    console.warn('Product mapping lookup failed:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// VALIDATION — collects warnings into `invoiceWarnings`
// ══════════════════════════════════════════════════════════════
function runValidation(gptResult, ocrFullText, uploadedPageCount) {
  invoiceWarnings = [];
  if (!gptResult) return;

  const items     = Array.isArray(gptResult.items) ? gptResult.items : [];
  const total     = parseFloat(gptResult.total)         || 0;
  const taxGst    = parseFloat(gptResult.tax_gst)       || 0;
  const taxPst    = parseFloat(gptResult.tax_pst)       || 0;
  const delivery  = (parseFloat(gptResult.delivery) || 0) + (parseFloat(gptResult.fuel_surcharge) || 0);
  const credit    = parseFloat(gptResult.credit)        || 0;
  const otherCost = parseFloat(gptResult.other_cost)    || 0;
  const deposit   = parseFloat(gptResult.deposit)       || 0;

  // Totals match check
  const itemsSum = items.reduce((s, it) => s + (parseFloat(it.cost) || 0), 0);
  const charges  = taxGst + taxPst + delivery + deposit + otherCost - credit;
  if (items.length > 0 && total > 0) {
    const tol = 1.00;
    const computedA = itemsSum + charges;
    const computedB = itemsSum + taxGst + taxPst - credit;
    const matchA = Math.abs(computedA - total) <= tol;
    const matchB = Math.abs(computedB - total) <= tol;
    if (!matchA && !matchB) {
      invoiceWarnings.push({
        id: 'totals_match',
        severity: 'warning',
        message: `Computed total doesn't match invoice total $${total.toFixed(2)}. Items $${itemsSum.toFixed(2)} + charges $${charges.toFixed(2)} = $${computedA.toFixed(2)}. Needs review.`,
      });
    }
  }

  // GPT "needs review" sentinel
  const reviewPattern = /needs[\s_-]*review/i;
  function deepSearch(obj, path) {
    if (typeof obj === 'string' && reviewPattern.test(obj)) {
      invoiceWarnings.push({
        id: 'gpt_needs_review_' + path,
        severity: 'warning',
        message: `Claude flagged field "${path}" as needing review: "${obj}"`,
      });
    } else if (Array.isArray(obj)) {
      obj.forEach((v, i) => deepSearch(v, path + '[' + i + ']'));
    } else if (obj && typeof obj === 'object') {
      Object.entries(obj).forEach(([k, v]) => deepSearch(v, path ? path + '.' + k : k));
    }
  }
  deepSearch(gptResult, '');

  // Missing pages hint.
  // Primary signal: structured page_total the model reports (reliable for photos,
  // where there's no text layer). Fallback: scan any verbatim page text for
  // "page N of N". Either way, warn when the invoice claims more pages than uploaded.
  let totalPages = parseInt(gptResult.page_total, 10);
  let pageSrc = totalPages > 0 ? `Invoice shows page ${parseInt(gptResult.page_current, 10) || '?'} of ${totalPages}` : '';
  if (!(totalPages > 0) && ocrFullText) {
    const m = ocrFullText.match(/\bpage\s+\d+\s+of\s+(\d+)\b/i);
    if (m) { totalPages = parseInt(m[1], 10); pageSrc = `Invoice text mentions "${m[0]}"`; }
  }
  if (totalPages > 1 && uploadedPageCount < totalPages) {
    invoiceWarnings.push({
      id: 'missing_pages',
      severity: 'warning',
      message: `${pageSrc} but only ${uploadedPageCount} page${uploadedPageCount === 1 ? '' : 's'} uploaded — possible missing page.`,
    });
  }
}

async function collectUnknownUnitWarnings() {
  if (!extractedRows.length) return;
  let approvedUnits = [];
  try {
    const data = await apiGet('tables/units?page=1&limit=100');
    approvedUnits = (data.data || []).map(u => (u.name || '').toLowerCase());
  } catch (_) { return; }
  if (!approvedUnits.length) return;

  const unknownMap = new Map();
  for (const row of extractedRows) {
    const packSize = (row.pack_size || '').trim();
    if (!packSize) continue;
    const m = packSize.match(/[\d.,]+\s*(.+)$/);
    if (!m) continue;
    const rawUnit = m[1].trim();
    if (!rawUnit) continue;
    const unitLower = rawUnit.toLowerCase();
    if (approvedUnits.includes(unitLower)) continue;
    if (!unknownMap.has(unitLower)) {
      unknownMap.set(unitLower, { displayName: rawUnit.toUpperCase(), products: [] });
    }
    unknownMap.get(unitLower).products.push((row.name || '').trim() || '(unnamed)');
  }
  for (const [, { displayName, products }] of unknownMap) {
    invoiceWarnings.push({
      id: 'unknown_unit_' + displayName.toLowerCase(),
      severity: 'info',
      message: `Unknown unit "${displayName}" found on ${products.length} product${products.length !== 1 ? 's' : ''} (${products.slice(0, 3).join(', ')}${products.length > 3 ? ', …' : ''}). Add it to your approved list to silence this.`,
    });
  }
}

// ══════════════════════════════════════════════════════════════
// PROGRESS / HELPERS
// ══════════════════════════════════════════════════════════════
function showProgress(pct, msg) {
  parseProgress().classList.remove('hidden');
  progressBar().style.width = pct + '%';
  parseStatus().textContent = msg;
}
function hideProgress() {
  setTimeout(() => parseProgress().classList.add('hidden'), 600);
}

function baseName(fileName) { return (fileName || '').replace(/\.[^.]+$/, ''); }
