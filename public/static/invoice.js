// ===== invoice.js (v4 — Azure OCR raw text panel + multi-file staging) =====

// ── PDF.js Worker ──────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

// ══════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════
let extractedRows   = [];
let rawTextDebug    = '';
let currentFileName = '';   // composite / first-file name
let currentFileKey  = '';   // R2 key of the first (or merged) file
let currentFileUrl  = '';   // URL to view
let currentTaxGst      = 0;
let currentTaxPst      = 0;
let currentDelivery    = 0;
let currentFuelSurcharge = 0;
let currentCredit      = 0;
let currentOtherCost   = 0;
let currentOtherDesc   = '';
let originalGptNames   = [];

// ── Multi-file staging state ───────────────────────────────────
// Each entry: { file: File, id: string, thumbUrl: string|null, type: 'pdf'|'img' }
let stagedFiles   = [];
let batchType     = null;   // 'pdf' | 'img' | null
let dragSrcIndex  = null;   // index of the item being dragged

// ── After processing: per-page invoice number for cross-check ──
let pageInvoiceNumbers = [];   // string[] — one per staged file after processing

// ── Azure OCR state ────────────────────────────────────────────
// Each entry: { pageNumber, fileName, text } — populated after Azure runs
let azureOcrPages   = [];   // raw OCR per page from Azure
let _azureConfigured = null; // null = not checked

// ── GPT-4o raw response state ──────────────────────────────────
// Each entry: { pageNumber, fileName, rawText } — populated after GPT-4o runs
let gptRawPages = [];

// ── Validation flags ───────────────────────────────────────────
// Set by runValidation() after GPT-4o returns; read by finalizeParse() and saveExtractedRows()
// Each flag: { id: string, message: string }
let invoiceFlags = [];

// ── DOM Refs ───────────────────────────────────────────────────
const dropZone      = () => document.getElementById('dropZone');
const fileInput     = () => document.getElementById('fileInput');
const parseProgress = () => document.getElementById('parseProgress');
const progressBar   = () => document.getElementById('progressBar');
const parseStatus   = () => document.getElementById('parseStatus');
const extractedSec  = () => document.getElementById('extractedSection');
const extractedBody = () => document.getElementById('extractedBody');
const manualSec     = () => document.getElementById('manualSection');
const manualRows    = () => document.getElementById('manualRows');

// ── Upload Events ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('dropZone')) return;

  checkAiStatus();
  checkAzureStatus();

  // Wire OCR panel buttons
  const ocrCopyAll = document.getElementById('ocrCopyAllBtn');
  if (ocrCopyAll) ocrCopyAll.addEventListener('click', () => {
    const allText = azureOcrPages.map((p, i) =>
      `=== Page ${p.pageNumber} (${p.fileName}) ===\n${p.text}`
    ).join('\n\n');
    navigator.clipboard?.writeText(allText)
      .then(() => showToast('All OCR text copied to clipboard!', 'success'))
      .catch(() => showToast('Copy failed — select text manually.', 'warning'));
  });
  const ocrCollapseAll = document.getElementById('ocrCollapseAllBtn');
  if (ocrCollapseAll) ocrCollapseAll.addEventListener('click', () => {
    document.querySelectorAll('.ocr-page-block').forEach(b => b.classList.add('collapsed'));
  });
  const ocrExpandAll = document.getElementById('ocrExpandAllBtn');
  if (ocrExpandAll) ocrExpandAll.addEventListener('click', () => {
    document.querySelectorAll('.ocr-page-block').forEach(b => b.classList.remove('collapsed'));
  });

  const dz = dropZone();
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('dragging'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragging'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('dragging');
    if (e.dataTransfer.files.length) addFilesToStage([...e.dataTransfer.files]);
  });

  fileInput().addEventListener('change', e => {
    if (e.target.files.length) addFilesToStage([...e.target.files]);
    // Reset the input so the same file(s) can be added again if user re-selects
    e.target.value = '';
  });

  document.getElementById('clearBatchBtn').addEventListener('click', clearBatch);
  document.getElementById('clearBatchLink').addEventListener('click', e => { e.preventDefault(); clearBatch(); });
  document.getElementById('submitBatchBtn').addEventListener('click', submitBatch);

  document.getElementById('addRowBtn').addEventListener('click', () => {
    extractedRows.push(emptyRow('Manual'));
    renderExtractedTable();
  });
  document.getElementById('saveAllBtn').addEventListener('click', saveExtractedRows);
  document.getElementById('addManualRowBtn').addEventListener('click', addManualRow);
  document.getElementById('saveManualBtn').addEventListener('click', saveManualRows);
});

// ══════════════════════════════════════════════════════════════
// MULTI-FILE STAGING
// ══════════════════════════════════════════════════════════════

function fileCategory(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['png','jpg','jpeg','webp'].includes(ext)) return 'img';
  return 'other';
}

async function addFilesToStage(files) {
  // Filter to supported types
  const supported = files.filter(f => {
    const cat = fileCategory(f);
    return cat === 'pdf' || cat === 'img';
  });

  if (!supported.length) {
    showToast('Only PDF and JPG/PNG files are supported for multi-page invoices.', 'error');
    return;
  }

  // Reject non-supported silently (but show toast if any were filtered)
  if (supported.length < files.length) {
    showToast('Some files were skipped (only PDF and JPG/PNG are supported).', 'warning');
  }

  // ── Enforce type consistency ──────────────────────────────────
  // Determine the type of the new files
  const newTypes = [...new Set(supported.map(fileCategory))];

  if (newTypes.length > 1) {
    showToast('Please add only PDF files OR only image files — not a mix.', 'error');
    showTypeMismatchWarn(batchType || newTypes[0], newTypes.filter(t => t !== (batchType || newTypes[0]))[0]);
    return;
  }

  const newType = newTypes[0];

  if (batchType && batchType !== newType) {
    // Trying to mix types
    showTypeMismatchWarn(batchType, newType);
    return;
  }

  // All good — set batch type if first add
  if (!batchType) batchType = newType;
  document.getElementById('typeMismatchWarn').style.display = 'none';

  // ── Build thumbnail & add to staged list ─────────────────────
  for (const file of supported) {
    const id = 'sf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const thumbUrl = newType === 'img' ? await makeImageThumb(file) : null;
    stagedFiles.push({ file, id, thumbUrl, type: newType });
  }

  renderStagedList();
}

function showTypeMismatchWarn(existingType, attemptedType) {
  const typeLabel = t => t === 'pdf' ? 'PDF' : 'image (JPG/PNG)';
  document.getElementById('existingTypeLabel').textContent  = typeLabel(existingType);
  document.getElementById('allowedTypeLabel').textContent   = typeLabel(existingType);
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
  // Reset post-processing sections
  extractedSec().classList.add('hidden');
  manualSec().classList.add('hidden');
  document.getElementById('invoiceMeta').classList.add('hidden');
  const costsPanel = document.getElementById('invoiceCosts');
  if (costsPanel) costsPanel.classList.add('hidden');
  const imgPreview = document.getElementById('invoiceImagePreview');
  if (imgPreview) imgPreview.classList.add('hidden');
  extractedRows = [];
  rawTextDebug  = '';
  azureOcrPages = [];
  gptRawPages   = [];
  invoiceFlags  = [];
  currentTaxGst = 0; currentTaxPst = 0; currentDelivery = 0; currentFuelSurcharge = 0;
  currentCredit = 0; currentOtherCost = 0; currentOtherDesc = '';
  currentFileName = ''; currentFileKey = ''; currentFileUrl = '';
  hideDebugPanel();
  hideOcrPanel();
  clearGptPanel();
  hideValidationBanner();
}

function makeImageThumb(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function renderStagedList() {
  const stage    = document.getElementById('fileStage');
  const list     = document.getElementById('stagedList');
  const badge    = document.getElementById('fileTypeBadge');
  const submitBar = document.getElementById('submitBar');

  if (!stagedFiles.length) { clearBatch(); return; }

  stage.classList.remove('hidden');

  // Badge
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
        <div class="file-name" title="${esc(sf.file.name)}">${esc(sf.file.name)}</div>
        <div class="file-meta">${sizeKb} KB</div>
      </div>
      <span class="page-label">Page ${pageNum}</span>
      <button class="remove-btn" data-id="${sf.id}" title="Remove this file">
        <i class="fas fa-times"></i>
      </button>
    `;

    // Drag-and-drop reordering
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
      // Reorder
      const moved = stagedFiles.splice(dragSrcIndex, 1)[0];
      stagedFiles.splice(idx, 0, moved);
      dragSrcIndex = null;
      renderStagedList();
    });

    // Remove button
    item.querySelector('.remove-btn').addEventListener('click', () => {
      stagedFiles = stagedFiles.filter(s => s.id !== sf.id);
      if (!stagedFiles.length) batchType = null;
      renderStagedList();
    });

    list.appendChild(item);
  });

  // Submit bar
  const count = stagedFiles.length;
  const noun  = batchType === 'pdf' ? (count === 1 ? 'PDF' : 'PDFs') : (count === 1 ? 'image' : 'images');
  document.getElementById('submitInfoText').textContent =
    `${count} ${noun} ready — ${count === 1 ? 'single page' : count + ' pages will be merged into one invoice'}`;
  submitBar.style.display = 'flex';
}

// ══════════════════════════════════════════════════════════════
// IMAGE PREPROCESSING PIPELINE
// Runs automatically on every image before Azure OCR.
// PDFs are skipped here (they are vector documents).
//
// Pipeline per image:
//   1. Decode → canvas
//   2. Quality check (DPI proxy, brightness, blur)  — reject if fails
//   3. Resize to max 3000px longest side
//   4. Contrast enhancement (histogram stretch)
//   5. Deskew (Hough-line angle detection on edges)
//   6. Re-encode as JPEG @ quality 0.88 (≤ 10 MB target)
//   Returns: { file: File, warnings: string[], rejected: bool, reason: string }
// ══════════════════════════════════════════════════════════════

// Thresholds — adjust after testing
const PREPROC = {
  MIN_SHORT_SIDE_PX : 900,    // proxy for ~150 DPI on a 6-inch invoice side
  MIN_AVG_BRIGHTNESS: 30,     // 0–255; below this = too dark
  MAX_AVG_BRIGHTNESS: 245,    // above this = washed out / overexposed
  MIN_BLUR_VARIANCE : 80,     // Laplacian variance; below = too blurry
  MAX_LONG_SIDE_PX  : 3000,   // resize target
  JPEG_QUALITY      : 0.88,   // JPEG encode quality after resize
  MAX_FILE_BYTES    : 10 * 1024 * 1024,  // 10 MB hard cap after compression
};

// Load an image File into an HTMLImageElement
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot decode image: ' + file.name)); };
    img.src = url;
  });
}

// Draw image to a new canvas at the given scale (1 = original size)
function imageToCanvas(img, scale = 1) {
  const w = Math.round(img.naturalWidth  * scale);
  const h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c;
}

// Get ImageData from a canvas
function getPixels(canvas) {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
}

// Convert RGBA pixels to grayscale Float32Array
function toGrayscale(pixels) {
  const gray = new Float32Array(pixels.width * pixels.height);
  const d    = pixels.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
  }
  return gray;
}

// Average brightness of grayscale array (0–255)
function avgBrightness(gray) {
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  return sum / gray.length;
}

// Laplacian variance — measures sharpness; low = blurry
// Uses a 3×3 Laplacian kernel on a subsampled version for speed
function laplacianVariance(gray, w, h) {
  // Subsample to max 400×400 for performance
  const scale  = Math.min(1, 400 / Math.max(w, h));
  const sw     = Math.max(1, Math.round(w * scale));
  const sh     = Math.max(1, Math.round(h * scale));

  // Build subsampled version
  const sub = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const sx = Math.round(x / scale);
      const sy = Math.round(y / scale);
      sub[y * sw + x] = gray[Math.min(sy, h-1) * w + Math.min(sx, w-1)];
    }
  }

  // Laplacian kernel: 0,1,0 / 1,-4,1 / 0,1,0
  let sumSq = 0, count = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const lap =
        sub[(y-1)*sw + x] + sub[(y+1)*sw + x] +
        sub[y*sw + (x-1)] + sub[y*sw + (x+1)] -
        4 * sub[y*sw + x];
      sumSq += lap * lap;
      count++;
    }
  }
  return count > 0 ? sumSq / count : 0;
}

// Contrast enhancement: per-channel histogram stretch (1st–99th percentile)
function enhanceContrast(canvas) {
  const ctx  = canvas.getContext('2d');
  const idata = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d    = idata.data;
  const len  = d.length;

  for (let ch = 0; ch < 3; ch++) {
    // Collect channel values
    const vals = new Uint8Array(len / 4);
    for (let i = 0, p = 0; i < len; i += 4, p++) vals[p] = d[i + ch];

    // Sort to find percentile cutoffs
    const sorted = vals.slice().sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.01)];
    const hi = sorted[Math.floor(sorted.length * 0.99)];
    if (hi === lo) continue; // flat channel, skip

    const scale = 255 / (hi - lo);
    for (let i = 0, p = 0; i < len; i += 4, p++) {
      d[i + ch] = Math.max(0, Math.min(255, Math.round((vals[p] - lo) * scale)));
    }
  }

  ctx.putImageData(idata, 0, 0);
}

// Deskew: detect dominant edge angle via Hough-like accumulator on a
// downsampled edge image, then rotate to correct it.
// Returns angle in degrees (positive = clockwise rotation needed).
function detectSkewAngle(gray, w, h) {
  // Work on a small version for speed
  const WORK = 600;
  const scale = Math.min(1, WORK / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));

  // Subsample grayscale
  const sub = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const sx = Math.round(x / scale), sy = Math.round(y / scale);
      sub[y*sw+x] = gray[Math.min(sy,h-1)*w + Math.min(sx,w-1)];
    }
  }

  // Simple Sobel edge magnitude
  const edge = new Float32Array(sw * sh);
  for (let y = 1; y < sh-1; y++) {
    for (let x = 1; x < sw-1; x++) {
      const gx =
        -sub[(y-1)*sw+(x-1)] + sub[(y-1)*sw+(x+1)]
        -2*sub[y*sw+(x-1)]   + 2*sub[y*sw+(x+1)]
        -sub[(y+1)*sw+(x-1)] + sub[(y+1)*sw+(x+1)];
      const gy =
        -sub[(y-1)*sw+(x-1)] - 2*sub[(y-1)*sw+x] - sub[(y-1)*sw+(x+1)]
        +sub[(y+1)*sw+(x-1)] + 2*sub[(y+1)*sw+x] + sub[(y+1)*sw+(x+1)];
      edge[y*sw+x] = Math.sqrt(gx*gx + gy*gy);
    }
  }

  // Threshold edges (top 5% of magnitudes)
  const edgeVals = edge.slice().sort((a,b) => a - b);
  const thresh   = edgeVals[Math.floor(edgeVals.length * 0.95)];

  // Accumulate angles from −10° to +10° in 0.5° steps
  const angleStep = 0.5;
  const angleMin  = -10;
  const angleMax  =  10;
  const bins      = Math.round((angleMax - angleMin) / angleStep) + 1;
  const acc       = new Float32Array(bins);

  for (let y = 1; y < sh-1; y++) {
    for (let x = 1; x < sw-1; x++) {
      if (edge[y*sw+x] < thresh) continue;
      // Local gradient direction (perpendicular to edge = line angle)
      const gx =
        -sub[(y-1)*sw+(x-1)] + sub[(y-1)*sw+(x+1)]
        -2*sub[y*sw+(x-1)]   + 2*sub[y*sw+(x+1)]
        -sub[(y+1)*sw+(x-1)] + sub[(y+1)*sw+(x+1)];
      const gy =
        -sub[(y-1)*sw+(x-1)] - 2*sub[(y-1)*sw+x] - sub[(y-1)*sw+(x+1)]
        +sub[(y+1)*sw+(x-1)] + 2*sub[(y+1)*sw+x] + sub[(y+1)*sw+(x+1)];
      const angle = Math.atan2(gy, gx) * 180 / Math.PI;
      // Normalise to the horizontal axis: text lines are roughly horizontal
      let norm = angle % 180;
      if (norm > 90)  norm -= 180;
      if (norm < -90) norm += 180;
      // Map to our ±10° window
      if (norm < angleMin || norm > angleMax) continue;
      const bin = Math.round((norm - angleMin) / angleStep);
      if (bin >= 0 && bin < bins) acc[bin] += edge[y*sw+x];
    }
  }

  // Find peak bin
  let best = 0, bestIdx = Math.round((0 - angleMin) / angleStep); // default 0°
  for (let i = 0; i < bins; i++) {
    if (acc[i] > best) { best = acc[i]; bestIdx = i; }
  }

  return angleMin + bestIdx * angleStep;
}

// Rotate canvas by angle (degrees). Returns a new canvas.
function rotateCanvas(canvas, angleDeg) {
  if (Math.abs(angleDeg) < 0.3) return canvas; // skip trivial rotation
  const rad  = angleDeg * Math.PI / 180;
  const cos  = Math.abs(Math.cos(rad));
  const sin  = Math.abs(Math.sin(rad));
  const nw   = Math.round(canvas.width * cos + canvas.height * sin);
  const nh   = Math.round(canvas.width * sin + canvas.height * cos);
  const out  = document.createElement('canvas');
  out.width  = nw; out.height = nh;
  const ctx  = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, nw, nh);
  ctx.translate(nw / 2, nh / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

// Canvas → File (JPEG)
function canvasToFile(canvas, name, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('Canvas toBlob failed')); return; }
      resolve(new File([blob], name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
    }, 'image/jpeg', quality);
  });
}

// ── Main preprocessing entry point ────────────────────────────
// Returns { file, rejected, reason, warnings, metrics }
async function preprocessImage(file) {
  let img;
  try {
    img = await loadImageFromFile(file);
  } catch (e) {
    return { file, rejected: true, reason: 'Cannot decode image — it may be corrupted.', warnings: [], metrics: {} };
  }

  const origW = img.naturalWidth;
  const origH = img.naturalHeight;
  const shortSide = Math.min(origW, origH);

  // Draw original to canvas
  let canvas = imageToCanvas(img, 1);
  const pixels = getPixels(canvas);
  const gray   = toGrayscale(pixels);
  const bright = avgBrightness(gray);
  const blur   = laplacianVariance(gray, origW, origH);
  const metrics = { width: origW, height: origH, brightness: Math.round(bright), blurVariance: Math.round(blur) };

  // ── Quality checks ────────────────────────────────────────
  if (shortSide < PREPROC.MIN_SHORT_SIDE_PX) {
    return { file, rejected: true, reason:
      `Resolution too low (${origW}×${origH}px — shortest side ${shortSide}px, minimum ${PREPROC.MIN_SHORT_SIDE_PX}px). ` +
      `Please re-scan or re-photograph the invoice at a higher resolution.`,
      warnings: [], metrics };
  }
  if (bright < PREPROC.MIN_AVG_BRIGHTNESS) {
    return { file, rejected: true, reason:
      `Image is too dark (brightness ${Math.round(bright)}/255, minimum ${PREPROC.MIN_AVG_BRIGHTNESS}). ` +
      `Please re-photograph the invoice with better lighting.`,
      warnings: [], metrics };
  }
  if (bright > PREPROC.MAX_AVG_BRIGHTNESS) {
    return { file, rejected: true, reason:
      `Image is overexposed / washed out (brightness ${Math.round(bright)}/255, maximum ${PREPROC.MAX_AVG_BRIGHTNESS}). ` +
      `Please re-photograph the invoice with less light or move away from direct glare.`,
      warnings: [], metrics };
  }
  if (blur < PREPROC.MIN_BLUR_VARIANCE) {
    return { file, rejected: true, reason:
      `Image is too blurry (sharpness score ${Math.round(blur)}, minimum ${PREPROC.MIN_BLUR_VARIANCE}). ` +
      `Please re-photograph the invoice — hold the camera steady and ensure the text is in focus.`,
      warnings: [], metrics };
  }

  const warnings = [];

  // ── Resize to max long-side ───────────────────────────────
  const longSide = Math.max(origW, origH);
  if (longSide > PREPROC.MAX_LONG_SIDE_PX) {
    const scale = PREPROC.MAX_LONG_SIDE_PX / longSide;
    canvas = imageToCanvas(img, scale);
    warnings.push(`Resized from ${origW}×${origH} to ${canvas.width}×${canvas.height}px`);
  }

  // ── Contrast enhancement ──────────────────────────────────
  enhanceContrast(canvas);

  // ── Deskew ────────────────────────────────────────────────
  // Re-sample grayscale on the (possibly resized) canvas for deskew
  const resizedPixels = getPixels(canvas);
  const resizedGray   = toGrayscale(resizedPixels);
  const skewAngle     = detectSkewAngle(resizedGray, canvas.width, canvas.height);
  if (Math.abs(skewAngle) >= 0.3) {
    canvas = rotateCanvas(canvas, skewAngle);
    warnings.push(`Deskewed ${skewAngle.toFixed(1)}°`);
  }

  // ── Encode to JPEG ────────────────────────────────────────
  let quality = PREPROC.JPEG_QUALITY;
  let outFile = await canvasToFile(canvas, file.name, quality);

  // If still over the size cap, reduce quality iteratively
  while (outFile.size > PREPROC.MAX_FILE_BYTES && quality > 0.5) {
    quality = Math.round((quality - 0.08) * 100) / 100;
    outFile = await canvasToFile(canvas, file.name, quality);
  }
  if (outFile.size > PREPROC.MAX_FILE_BYTES) {
    warnings.push(`Warning: compressed file is still ${(outFile.size / 1024 / 1024).toFixed(1)} MB — Azure may reject it.`);
  }
  if (quality < PREPROC.JPEG_QUALITY) {
    warnings.push(`Compressed to quality ${Math.round(quality * 100)}% to stay under 10 MB`);
  }

  metrics.finalWidth  = canvas.width;
  metrics.finalHeight = canvas.height;
  metrics.finalSizeMB = (outFile.size / 1024 / 1024).toFixed(2);
  metrics.skewAngle   = skewAngle.toFixed(1);

  return { file: outFile, rejected: false, reason: '', warnings, metrics };
}

// ── Run preprocessing on all image staged files ───────────────
// Returns false if any file was rejected (caller should abort).
// On success, replaces stagedFiles[i].file with the processed version
// and updates the thumbnail.
async function runPreprocessingPipeline() {
  const imgIndices = stagedFiles
    .map((sf, i) => ({ sf, i }))
    .filter(({ sf }) => sf.type === 'img');

  if (!imgIndices.length) return true; // PDFs: nothing to do

  const total = imgIndices.length;
  const rejections = [];

  for (let j = 0; j < total; j++) {
    const { sf, i } = imgIndices[j];
    showProgress(
      Math.round((j / total) * 30),
      `Checking quality: page ${j + 1}/${total} (${sf.file.name})…`
    );

    const result = await preprocessImage(sf.file);

    if (result.rejected) {
      rejections.push({ pageNum: j + 1, fileName: sf.file.name, reason: result.reason });
      continue;
    }

    // Replace the file in stagedFiles with the preprocessed version
    stagedFiles[i].file = result.file;

    // Update thumbnail to show the enhanced version
    const reader = new FileReader();
    reader.onload = e => { stagedFiles[i].thumbUrl = e.target.result; };
    reader.readAsDataURL(result.file);

    if (result.warnings.length) {
      console.info(`Preprocessing [${sf.file.name}]:`, result.warnings.join('; '));
    }
  }

  if (rejections.length) {
    // Show a blocking error panel listing every rejected page
    const existing = document.getElementById('qualityBlocker');
    if (existing) existing.remove();

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
    if (uploadCard && uploadCard.parentNode) {
      uploadCard.parentNode.insertBefore(blocker, uploadCard.nextSibling);
    }

    hideProgress();
    // Reset submit button
    const btn = document.getElementById('submitBatchBtn');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> Submit &amp; Process'; }
    return false;
  }

  return true; // all pages passed
}

// ══════════════════════════════════════════════════════════════
// SUBMIT BATCH  — process all staged files as one invoice
// ══════════════════════════════════════════════════════════════
async function submitBatch() {
  if (!stagedFiles.length) return;

  // Disable the button
  const btn = document.getElementById('submitBatchBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…';

  // Reset state
  extractedRows = [];
  rawTextDebug  = '';
  azureOcrPages = [];
  gptRawPages   = [];
  invoiceFlags  = [];
  originalGptNames = [];
  currentFileName = ''; currentFileKey = ''; currentFileUrl = '';
  currentTaxGst = 0; currentTaxPst = 0; currentDelivery = 0; currentFuelSurcharge = 0;
  currentCredit = 0; currentOtherCost = 0; currentOtherDesc = '';
  pageInvoiceNumbers = [];

  extractedSec().classList.add('hidden');
  manualSec().classList.add('hidden');
  document.getElementById('invoiceMeta').classList.add('hidden');
  const costsPanelReset = document.getElementById('invoiceCosts');
  if (costsPanelReset) costsPanelReset.classList.add('hidden');
  hideDebugPanel();
  hideOcrPanel();
  clearGptPanel();
  hideValidationBanner();
  // Re-enable save button in case it was locked by a previous validation run
  const prevSaveBtn = document.getElementById('saveAllBtn');
  if (prevSaveBtn) { prevSaveBtn.disabled = false; prevSaveBtn.title = ''; }
  const existingBlocker = document.getElementById('azureBlocker');
  if (existingBlocker) existingBlocker.remove();
  const existingQualityBlocker = document.getElementById('qualityBlocker');
  if (existingQualityBlocker) existingQualityBlocker.remove();

  try {
    // ── Image preprocessing (quality check + enhance) ─────────────
    // Only runs for image batches; PDFs are skipped inside the function.
    // Returns false and shows a blocking error panel if any image is rejected.
    showProgress(0, 'Checking image quality…');
    const preprocOk = await runPreprocessingPipeline();
    if (!preprocOk) {
      // runPreprocessingPipeline already showed the error panel and reset the button
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-magic"></i> Submit &amp; Process';
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
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-magic"></i> Submit &amp; Process';
}

// ── PDF batch: merge all pages into one logical document ──────
async function processPDFBatch() {
  const files = stagedFiles.map(s => s.file);
  const total = files.length;

  showProgress(5, `Loading ${total} PDF${total > 1 ? 's' : ''}…`);

  // ── Upload the FIRST file to R2 (primary invoice file) ─────
  try {
    const uploaded = await apiUploadFile(files[0]);
    currentFileKey  = uploaded.key;
    currentFileUrl  = uploaded.url;
    currentFileName = files[0].name;
  } catch (upErr) {
    console.warn('R2 upload failed (continuing):', upErr.message);
    currentFileName = files[0].name;
  }

  // ── Step 1: Azure OCR — REQUIRED. Failure stops processing. ──
  if (!_azureConfigured) {
    hideProgress();
    showAzureBlocker('Azure Document Intelligence is not configured on this server. All invoices must go through Azure OCR. Please add AZURE_DOC_INTEL_KEY and AZURE_DOC_INTEL_ENDPOINT to the server environment.');
    return;
  }

  let azureFullText = '';
  let azureFailedFile = null;
  let azureFailedReason = '';

  for (let fi = 0; fi < files.length; fi++) {
    showProgress(5 + Math.round((fi / total) * 30), `Azure OCR: page ${fi + 1}/${total}…`);
    try {
      const ocrResult = await callAzureOcr(files[fi]);
      const offset = azureOcrPages.length;
      (ocrResult.pageTexts || []).forEach((pt, i) => {
        azureOcrPages.push({
          pageNumber: offset + i + 1,
          fileName:   files[fi].name,
          text:       pt.text || '',
        });
      });
      if (!(ocrResult.pageTexts || []).length && ocrResult.fullText) {
        azureOcrPages.push({
          pageNumber: azureOcrPages.length + 1,
          fileName:   files[fi].name,
          text:       ocrResult.fullText,
        });
      }
      azureFullText += (ocrResult.fullText || '') + '\n';
    } catch (azErr) {
      azureFailedFile   = files[fi].name;
      azureFailedReason = azErr.message;
      break;
    }
  }

  if (azureFailedFile) {
    hideProgress();
    showAzureBlocker(`Azure OCR failed for "${azureFailedFile}":\n${azureFailedReason}\n\nProcessing has been stopped. Fix the issue and try again. No fallback will be used.`);
    return;
  }

  // ── Step 2: PDF.js text extraction (always runs as supplement / fallback) ──
  let allItems   = [];   // { str, x, y, page } across all docs
  let fullText   = azureFullText;  // start with Azure text if available
  let pageOffset = 0;

  for (let fi = 0; fi < files.length; fi++) {
    showProgress(35 + Math.round((fi / total) * 30), `Parsing PDF ${fi + 1}/${total}…`);
    const ab  = await files[fi].arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc   = await page.getTextContent();
      const vp   = page.getViewport({ scale: 1 });
      tc.items.forEach(it => {
        if (!it.str.trim()) return;
        const x = it.transform[4];
        const y = vp.height - it.transform[5];
        allItems.push({ str: it.str.trim(), x, y, page: pageOffset + p });
        // Only add to fullText if Azure didn't already extract it
        if (!_azureConfigured) fullText += it.str + ' ';
      });
      if (!_azureConfigured) fullText += '\n';
    }

    // Per-file invoice number extraction (for cross-page check)
    const textForCheck = azureFullText ||
      allItems.filter(it => it.page <= pageOffset + pdf.numPages)
              .map(it => it.str).join(' ');
    const invNumMatch = textForCheck.match(/(?:invoice\s*(?:no|num|number|#)?[:.\s]*)([\w\-\/]{3,20})/i);
    pageInvoiceNumbers.push(invNumMatch ? invNumMatch[1].trim() : '');

    pageOffset += pdf.numPages;
  }

  // Prefer Azure text for rawTextDebug (shown in debug panel)
  rawTextDebug = azureFullText || fullText;

  showProgress(68, 'Analysing structure…');
  extractedRows = detectTableByColumns(allItems, files[0].name);
  if (!extractedRows.length) extractedRows = parseTextToRows(rawTextDebug, files[0].name);

  // GPT-4o pass — always runs when AI is configured (Azure text is now available)
  if (_aiConfigured) {
    const textForAI = (azureFullText || rawTextDebug || fullText || '').trim();
    if (textForAI) {
      showProgress(75, 'Sending Azure OCR text to GPT-4o…');
      try {
        const { result: aiResult, rawText: aiRaw } = await callOpenAIText(textForAI);
        gptRawPages.push({ pageNumber: gptRawPages.length + 1, fileName: files[0].name, rawText: aiRaw || '' });
        extractedRows = mapOpenAIResult(aiResult, files[0].name);

        // Apply product mappings before validation
        const mappingVendor = document.getElementById('metaVendor')?.value.trim() || '';
        if (mappingVendor) {
          await applyProductMappings(mappingVendor);
        }

        // Run validation after GPT returns
        runValidation(aiResult, azureFullText || rawTextDebug || fullText, files.length);
      } catch (aiErr) {
        hideProgress();
        showToast('GPT-4o parsing failed: ' + aiErr.message, 'error');
        finalizeParse(files[0].name);
        return;
      }
    }
  }

  showProgress(100, 'Done!');
  await checkInvoiceNumberConsistency(() => finalizeParse(files[0].name));
}

// ── Image batch: Azure OCR first, then AI Vision for structured extraction ──
async function processImageBatch() {
  const files = stagedFiles.map(s => s.file);
  const total = files.length;

  if (!_aiConfigured && !_azureConfigured) {
    showToast('Neither OpenAI nor Azure is configured — entering manual mode.', 'warning');
    hideProgress();
    currentFileName = files[0].name;
    document.getElementById('invoiceMeta').classList.remove('hidden');
    const costsPanelManual = document.getElementById('invoiceCosts');
    if (costsPanelManual) costsPanelManual.classList.remove('hidden');
    manualSec().classList.remove('hidden');
    addManualRow();
    return;
  }

  // Preprocessing already ran (0–30%); continue from 35%
  showProgress(35, `Uploading ${total} image${total > 1 ? 's' : ''} to cloud…`);

  // Upload first image to R2
  try {
    const uploaded = await apiUploadFile(files[0]);
    currentFileKey  = uploaded.key;
    currentFileUrl  = uploaded.url;
    currentFileName = files[0].name;
  } catch (upErr) {
    console.warn('R2 upload failed (continuing):', upErr.message);
    currentFileName = files[0].name;
  }

  // ── Step 1: Azure OCR — REQUIRED. Failure stops processing. ──
  if (!_azureConfigured) {
    // Azure not configured at all — hard stop
    hideProgress();
    showAzureBlocker('Azure Document Intelligence is not configured on this server. All invoices must go through Azure OCR. Please add AZURE_DOC_INTEL_KEY and AZURE_DOC_INTEL_ENDPOINT to the server environment.');
    return;
  }

  let azureFailedFile = null;
  let azureFailedReason = '';

  for (let fi = 0; fi < files.length; fi++) {
    showProgress(40 + Math.round((fi / total) * 25), `Azure OCR: page ${fi + 1}/${total}…`);
    try {
      const ocrResult = await callAzureOcr(files[fi]);
      const offset = azureOcrPages.length;
      (ocrResult.pageTexts || []).forEach((pt, i) => {
        azureOcrPages.push({
          pageNumber: offset + i + 1,
          fileName:   files[fi].name,
          text:       pt.text || '',
        });
      });
      if (!(ocrResult.pageTexts || []).length && ocrResult.fullText) {
        azureOcrPages.push({
          pageNumber: azureOcrPages.length + 1,
          fileName:   files[fi].name,
          text:       ocrResult.fullText,
        });
      }
      // If Azure returned no text at all, that is itself an error
      if (!azureOcrPages.find(p => p.fileName === files[fi].name && p.text.trim())) {
        azureFailedFile = files[fi].name;
        azureFailedReason = 'Azure returned no text for this file. The file may be blank, corrupted, or an unsupported format.';
        break;
      }
    } catch (azErr) {
      azureFailedFile   = files[fi].name;
      azureFailedReason = azErr.message;
      break;
    }
  }

  if (azureFailedFile) {
    hideProgress();
    showAzureBlocker(`Azure OCR failed for "${azureFailedFile}":\n${azureFailedReason}\n\nProcessing has been stopped. Fix the issue and try again. No fallback will be used.`);
    return;
  }

  // ── Step 2: GPT-4o — receives Azure text, not the image ──────
  if (!_aiConfigured) {
    // Azure succeeded but GPT-4o not configured — show OCR panel, go manual
    showProgress(100, 'Done!');
    finalizeParse(files[0].name);
    return;
  }

  showProgress(70, 'Sending OCR text to GPT-4o…');

  const combinedOcrText = azureOcrPages.map(p =>
    azureOcrPages.length > 1 ? `--- Page ${p.pageNumber} (${p.fileName}) ---\n${p.text}` : p.text
  ).join('\n\n').trim();

  try {
    showProgress(80, 'GPT-4o parsing OCR text…');
    const { result, rawText } = await callOpenAIText(combinedOcrText);
    gptRawPages.push({ pageNumber: 1, fileName: files[0].name, rawText: rawText || '' });
    pageInvoiceNumbers.push(result.invoice_number || '');
    extractedRows = mapOpenAIResult(result, files[0].name);

    // Apply product mappings before validation
    const mappingVendor = document.getElementById('metaVendor')?.value.trim() || '';
    if (mappingVendor) {
      await applyProductMappings(mappingVendor);
    }

    // Run validation after GPT returns
    runValidation(result, combinedOcrText, files.length);
  } catch (aiErr) {
    hideProgress();
    showToast('GPT-4o parsing failed: ' + aiErr.message, 'error');
    // Azure OCR panel still shows — user can see the raw text
    finalizeParse(files[0].name);
    return;
  }

  showProgress(100, 'Done!');
  await checkInvoiceNumberConsistency(() => finalizeParse(files[0].name));
}

// ══════════════════════════════════════════════════════════════
// CROSS-PAGE INVOICE NUMBER VALIDATION
// ══════════════════════════════════════════════════════════════
async function checkInvoiceNumberConsistency(proceedFn) {
  // Filter out blank entries
  const nums = pageInvoiceNumbers.filter(n => n && n.trim());

  if (nums.length < 2) {
    // Only one (or zero) pages have numbers — no conflict possible
    proceedFn();
    return;
  }

  // Check if all non-blank invoice numbers match
  const first = nums[0].trim().toLowerCase();
  const mismatch = nums.some(n => n.trim().toLowerCase() !== first);

  if (!mismatch) {
    proceedFn();
    return;
  }

  // Build detail list
  const details = pageInvoiceNumbers.map((n, i) =>
    `<div>Page ${i + 1}: <strong>${n ? esc(n) : '<em>not detected</em>'}</strong></div>`
  ).join('');

  document.getElementById('invNumWarnDetails').innerHTML = details;

  // Wire the "proceed anyway" button
  document.getElementById('ignoreInvNumWarnBtn').onclick = () => {
    closeModal('invNumWarnModal');
    proceedFn();
  };

  openModal('invNumWarnModal');
  // proceedFn is only called when user decides
}

// ══════════════════════════════════════════════════════════════
// AI KEY STATUS
// ══════════════════════════════════════════════════════════════
let _aiConfigured = null;

async function checkAiStatus() {
  try {
    const data = await apiGet('ai/status');
    _aiConfigured = !!data.configured;
  } catch (_) {
    _aiConfigured = false;
  }
  updateApiKeyStatus();
}

function updateApiKeyStatus() {
  const el = document.getElementById('apiKeyStatus');
  if (!el) return;
  if (_aiConfigured === null) {
    el.innerHTML = '<i class="fas fa-spinner fa-spin" style="color:#6b7280"></i> Checking AI status…';
    el.style.color = '#6b7280';
  } else if (_aiConfigured) {
    el.innerHTML = '<i class="fas fa-check-circle" style="color:#16a34a"></i> AI ready — OpenAI key configured on server';
    el.style.color = '#16a34a';
  } else {
    el.innerHTML = '<i class="fas fa-exclamation-circle" style="color:#d97706"></i> No API key on server — add OPENAI_API_KEY to .dev.vars (local) or wrangler secret (production)';
    el.style.color = '#d97706';
  }
}

// ══════════════════════════════════════════════════════════════
// AZURE STATUS + OCR CALL
// ══════════════════════════════════════════════════════════════
async function checkAzureStatus() {
  try {
    const data = await apiGet('ai/azure-status');
    _azureConfigured = !!data.configured;
  } catch (_) {
    _azureConfigured = false;
  }
  updateAzureKeyStatus();
}

function updateAzureKeyStatus() {
  const el = document.getElementById('azureKeyStatus');
  if (!el) return;
  if (_azureConfigured === null) {
    el.innerHTML = '<i class="fas fa-spinner fa-spin" style="color:#6b7280"></i> Checking…';
    el.style.color = '#6b7280';
  } else if (_azureConfigured) {
    el.innerHTML = '<i class="fas fa-check-circle" style="color:#16a34a"></i> Azure OCR ready';
    el.style.color = '#16a34a';
  } else {
    el.innerHTML = '<i class="fas fa-times-circle" style="color:#94a3b8"></i> Not configured';
    el.style.color = '#94a3b8';
  }
}

// Send one file to Azure Document Intelligence, return { pageTexts, fullText, analyzeResult }
async function callAzureOcr(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/ai/azure-analyze', {
    method: 'POST',
    body: formData,
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || `Azure error ${response.status}`);
  return data;  // { success, analyzeResult, pageTexts, fullText }
}

// ══════════════════════════════════════════════════════════════
// RAW OCR OUTPUT PANEL
// ══════════════════════════════════════════════════════════════

// Render the panel with current azureOcrPages data
function renderOcrPanel() {
  const section = document.getElementById('rawOcrSection');
  const container = document.getElementById('ocrPages');
  if (!section || !container) return;

  if (!azureOcrPages.length) { hideOcrPanel(); return; }

  container.innerHTML = '';
  azureOcrPages.forEach((pg, idx) => {
    const block = document.createElement('div');
    block.className = 'ocr-page-block';
    block.dataset.idx = idx;

    const charCount = pg.text.length;
    const lineCount = (pg.text.match(/\n/g) || []).length + 1;

    block.innerHTML = `
      <div class="ocr-page-header">
        <div class="ocr-page-label">
          <span class="page-num">${pg.pageNumber}</span>
          Page ${pg.pageNumber}${pg.fileName ? ' — ' + esc(pg.fileName) : ''}
        </div>
        <div style="display:flex;align-items:center;gap:.75rem">
          <span class="ocr-char-count">${lineCount} lines · ${charCount} chars</span>
          <i class="fas fa-chevron-down ocr-toggle-icon"></i>
        </div>
      </div>
      <div class="ocr-page-body">
        <pre class="ocr-text" id="ocr-text-${idx}">${esc(pg.text)}</pre>
        <button class="btn btn-secondary btn-sm ocr-copy-btn" data-idx="${idx}">
          <i class="fas fa-copy"></i> Copy Page ${pg.pageNumber}
        </button>
      </div>
    `;

    // Toggle collapse/expand on header click
    block.querySelector('.ocr-page-header').addEventListener('click', () => {
      block.classList.toggle('collapsed');
    });

    // Per-page copy button
    block.querySelector('.ocr-copy-btn').addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard?.writeText(pg.text)
        .then(() => showToast(`Page ${pg.pageNumber} OCR text copied!`, 'success'))
        .catch(() => showToast('Copy failed — select text manually.', 'warning'));
    });

    container.appendChild(block);
  });

  section.classList.remove('hidden');
}

function hideOcrPanel() {
  const section = document.getElementById('rawOcrSection');
  if (section) section.classList.add('hidden');
}

function clearGptPanel() {
  const section = document.getElementById('rawGptSection');
  if (section) section.classList.add('hidden');
}

// Show a permanent, prominent error block when Azure fails.
// Processing is already stopped at the call site before this is called.
function showAzureBlocker(message) {
  // Remove any existing blocker first
  const existing = document.getElementById('azureBlocker');
  if (existing) existing.remove();

  const blocker = document.createElement('div');
  blocker.id = 'azureBlocker';
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
        <strong style="display:block;font-size:1rem;margin-bottom:.4rem">Azure OCR Failed — Processing Stopped</strong>
        <pre style="white-space:pre-wrap;font-family:inherit;margin:0">${esc(message)}</pre>
      </div>
    </div>
  `;

  // Insert above the progress bar / results area
  const uploadCard = document.querySelector('.upload-card');
  if (uploadCard && uploadCard.parentNode) {
    uploadCard.parentNode.insertBefore(blocker, uploadCard.nextSibling);
  } else {
    document.body.appendChild(blocker);
  }

  // Also show as a persistent toast so it's impossible to miss
  showToast('Azure OCR failed — processing stopped. See error details on screen.', 'error');

  // Reset submit button
  const btn = document.getElementById('submitBatchBtn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-magic"></i> Submit &amp; Process';
  }
}

// ══════════════════════════════════════════════════════════════
// GPT-4o RAW RESPONSE PANEL
// ══════════════════════════════════════════════════════════════

function renderGptPanel() {
  const section   = document.getElementById('rawGptSection');
  const container = document.getElementById('gptPages');
  if (!section || !container) return;
  if (!gptRawPages.length) { clearGptPanel(); return; }

  container.innerHTML = '';

  gptRawPages.forEach((pg, idx) => {
    const block = document.createElement('div');
    block.className = 'ocr-page-block';
    block.dataset.idx = idx;

    const charCount = pg.rawText.length;
    const lineCount = (pg.rawText.match(/\n/g) || []).length + 1;

    // Attempt pretty-print; fall back to raw string if it fails
    let prettyText = pg.rawText;
    try { prettyText = JSON.stringify(JSON.parse(pg.rawText), null, 2); } catch (_) {}

    block.innerHTML = `
      <div class="ocr-page-header">
        <div class="ocr-page-label">
          <span class="page-num">${pg.pageNumber}</span>
          Page ${pg.pageNumber}${pg.fileName ? ' \u2014 ' + esc(pg.fileName) : ''}
        </div>
        <div style="display:flex;align-items:center;gap:.75rem">
          <span class="ocr-char-count">${lineCount} lines \u00b7 ${charCount} chars</span>
          <i class="fas fa-chevron-down ocr-toggle-icon"></i>
        </div>
      </div>
      <div class="ocr-page-body">
        <pre class="ocr-text" id="gpt-text-${idx}" style="color:#1a1a2e">${esc(prettyText)}</pre>
        <button class="btn btn-secondary btn-sm ocr-copy-btn" data-idx="${idx}">
          <i class="fas fa-copy"></i> Copy Page ${pg.pageNumber}
        </button>
      </div>
    `;

    block.querySelector('.ocr-page-header').addEventListener('click', () => {
      block.classList.toggle('collapsed');
    });

    block.querySelector('.ocr-copy-btn').addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard?.writeText(prettyText)
        .then(() => showToast(`GPT-4o response for page ${pg.pageNumber} copied!`, 'success'))
        .catch(() => showToast('Copy failed \u2014 select text manually.', 'warning'));
    });

    container.appendChild(block);
  });

  section.classList.remove('hidden');

  // Wire header buttons (idempotent — re-wire each render)
  const copyAll = document.getElementById('gptCopyAllBtn');
  if (copyAll) {
    copyAll.onclick = () => {
      const allText = gptRawPages.map(p => {
        let pretty = p.rawText;
        try { pretty = JSON.stringify(JSON.parse(p.rawText), null, 2); } catch (_) {}
        return `=== Page ${p.pageNumber} (${p.fileName}) ===\n${pretty}`;
      }).join('\n\n');
      navigator.clipboard?.writeText(allText)
        .then(() => showToast('All GPT-4o responses copied!', 'success'))
        .catch(() => showToast('Copy failed \u2014 select text manually.', 'warning'));
    };
  }
  const collapseAll = document.getElementById('gptCollapseAllBtn');
  if (collapseAll) {
    collapseAll.onclick = () =>
      document.querySelectorAll('#gptPages .ocr-page-block').forEach(b => b.classList.add('collapsed'));
  }
  const expandAll = document.getElementById('gptExpandAllBtn');
  if (expandAll) {
    expandAll.onclick = () =>
      document.querySelectorAll('#gptPages .ocr-page-block').forEach(b => b.classList.remove('collapsed'));
  }
}

// ══════════════════════════════════════════════════════════════
// SERVER-SIDE AI CALLS
// ══════════════════════════════════════════════════════════════

// Send Azure OCR text to GPT-4o for structured extraction (preferred path)
async function callOpenAIText(ocrText) {
  if (!_aiConfigured) throw new Error('OpenAI API key is not configured on the server. See Settings.');
  const response = await fetch('/api/ai/parse-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ocrText })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || `Server error ${response.status}`);
  return { result: data.result, rawText: data.rawText || JSON.stringify(data.result, null, 2) };
}

// Send raw image to GPT-4o Vision (fallback when Azure is not configured)
async function callOpenAIVision(base64Image, mimeType) {
  if (!_aiConfigured) throw new Error('OpenAI API key is not configured on the server. See Settings.');
  const response = await fetch('/api/ai/parse-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64: base64Image, mimeType })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || `Server error ${response.status}`);
  return { result: data.result, rawText: data.rawText || JSON.stringify(data.result, null, 2) };
}

// ── Convert file to base64 ─────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Map OpenAI result → extractedRows ─────────────────────────
function mapOpenAIResult(result, fileName) {
  const ref = baseName(fileName);
  if (result.vendor)         { const el = document.getElementById('metaVendor');      if (el) el.value = result.vendor; }
  if (result.invoice_number) { const el = document.getElementById('metaInvoiceNum');  if (el) el.value = result.invoice_number; }
  if (result.invoice_date)   { const el = document.getElementById('metaInvoiceDate'); if (el) el.value = result.invoice_date; }
  if (result.total)          { const el = document.getElementById('metaTotal');        if (el) el.value = result.total; }

  // Map each GPT-4o field directly to its own state variable — no merging.
  currentTaxGst        = parseFloat(result.tax_gst)        || 0;
  currentTaxPst        = parseFloat(result.tax_pst)        || 0;
  currentDelivery      = parseFloat(result.delivery)       || 0;
  currentFuelSurcharge = parseFloat(result.fuel_surcharge) || 0;
  currentCredit        = parseFloat(result.credit)         || 0;
  currentOtherCost     = parseFloat(result.other_cost)     || 0;
  currentOtherDesc     = result.other_desc || '';

  // Populate the visible Additional Costs fields on the upload page
  const elGst   = document.getElementById('metaTaxGst');
  const elPst   = document.getElementById('metaTaxPst');
  const elDel   = document.getElementById('metaDelivery');
  const elFuel  = document.getElementById('metaFuelSurcharge');
  const elCred  = document.getElementById('metaCredit');
  const elOther = document.getElementById('metaOtherCost');
  const elODesc = document.getElementById('metaOtherDesc');
  if (elGst)   elGst.value   = currentTaxGst.toFixed(2);
  if (elPst)   elPst.value   = currentTaxPst.toFixed(2);
  if (elDel)   elDel.value   = currentDelivery.toFixed(2);
  if (elFuel)  elFuel.value  = currentFuelSurcharge.toFixed(2);
  if (elCred)  elCred.value  = currentCredit.toFixed(2);
  if (elOther) elOther.value = currentOtherCost.toFixed(2);
  if (elODesc) elODesc.value = currentOtherDesc;

  // Save original GPT-4o product names before any user edits or mappings
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
// PRODUCT MAPPING — auto-replace GPT-4o names with learned corrections
// ══════════════════════════════════════════════════════════════
async function applyProductMappings(vendor) {
  if (!vendor || !vendor.trim()) return;
  try {
    const data = await apiGet('product-mappings?vendor=' + encodeURIComponent(vendor.trim()));
    const mappings = data.data || [];
    if (!mappings.length) return;

    // Build a lookup: lowercase raw_ocr_text → mapping object
    const lookup = {};
    mappings.forEach(m => {
      lookup[m.raw_ocr_text.toLowerCase().trim()] = m;
    });

    extractedRows.forEach((row, idx) => {
      // Match against original_ocr first, then GPT name
      const ocrKey = (row._original_ocr || '').toLowerCase().trim();
      const nameKey = (originalGptNames[idx] || row.name || '').toLowerCase().trim();
      const match = lookup[ocrKey] || lookup[nameKey];
      if (match) {
        row.name      = match.corrected_name;
        row.brand     = match.corrected_brand || row.brand;
        row.sku       = match.corrected_sku   || row.sku;
        row.pack_size = match.corrected_pack_size || row.pack_size;
        row._auto_mapped = true;
      }
    });
  } catch (e) {
    console.warn('Product mapping lookup failed:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// LEGACY SINGLE-FILE HANDLER (kept for backward compatibility)
// Called by the old drop/input path — now routes to stage
// ══════════════════════════════════════════════════════════════
async function handleFile(file) {
  await addFilesToStage([file]);
}

// ══════════════════════════════════════════════════════════════
// PDF PARSER — delegates to processPDFBatch (enforces Azure)
// ══════════════════════════════════════════════════════════════
// The old standalone parsePDF sent images directly to Vision and bypassed
// Azure. It is replaced by a delegation so every path goes through Azure.
async function parsePDF(file) {
  await processPDFBatch();
}

// ── Column-based table detector ────────────────────────────────
function detectTableByColumns(items, invoiceRef) {
  const refName = baseName(invoiceRef);
  const ROW_TOL = 6;
  const rowMap  = new Map();
  items.forEach(it => {
    const key = Math.round(it.y / ROW_TOL) * ROW_TOL;
    if (!rowMap.has(key)) rowMap.set(key, []);
    rowMap.get(key).push(it);
  });

  const rows = [...rowMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, cells]) => cells.sort((a, b) => a.x - b.x));

  if (rows.length < 2) return [];

  const headerKeywords = ['item','product','description','name','qty','quantity',
                          'price','cost','amount','unit','sku','code','total',
                          'pack','brand','expiry','bb','best','use'];
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const rowText = rows[i].map(c => c.str.toLowerCase()).join(' ');
    const hits = headerKeywords.filter(k => rowText.includes(k)).length;
    if (hits >= 2) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return [];

  const headerCells = rows[headerIdx];
  const colAlias = {
    name:        ['item','product','description','name','goods','service','detail'],
    brand:       ['brand','manufacturer','mfr','make','supplier'],
    sku:         ['sku','code','barcode','item#','item no','product code','ref'],
    pack_size:   ['pack','pack size','unit size','size','uom'],
    qty:         ['qty','quantity','units','pcs','ordered','shipped'],
    cost:        ['price','unit price','unit cost','cost','rate','each','excl','ex gst','nett'],
    total:       ['total','amount','line total','subtotal','ext','extended','inc gst','incl'],
    expiry_date: ['expiry','exp','best before','bb','use by','best_before'],
  };

  function mapHeaderCell(cellStr) {
    const s = cellStr.toLowerCase().trim();
    for (const [field, aliases] of Object.entries(colAlias)) {
      if (aliases.some(a => s.includes(a))) return field;
    }
    return null;
  }

  const colXMap = [];
  headerCells.forEach(cell => {
    const field = mapHeaderCell(cell.str);
    if (field) colXMap.push({ x: cell.x, field });
  });
  if (!colXMap.length) return [];

  colXMap.sort((a, b) => a.x - b.x);
  const colXPositions = colXMap.map(c => c.x);

  function nearestCol(x) {
    let best = 0, bestDist = Infinity;
    colXPositions.forEach((cx, i) => {
      const d = Math.abs(x - cx);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return bestDist < 120 ? colXMap[best].field : null;
  }

  const result = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const rowCells = rows[i];
    if (!rowCells.length) continue;
    const obj = {};
    rowCells.forEach(cell => {
      const field = nearestCol(cell.x);
      if (field) obj[field] = obj[field] ? obj[field] + ' ' + cell.str : cell.str;
    });
    if (!obj.name) continue;

    let cost = parseMoney(obj.cost || obj.total || '');
    if (isNaN(cost) || cost <= 0) {
      const allVals = rowCells.map(c => parseMoney(c.str)).filter(v => !isNaN(v) && v > 0);
      cost = allVals[allVals.length - 1] ?? 0;
    }

    const expiry    = parseDate(obj.expiry_date || '');
    const cleanName = cleanStr(obj.name);
    if (!cleanName || cleanName.length < 2) continue;

    result.push({
      name:        cleanName,
      brand:       cleanStr(obj.brand  || ''),
      sku:         cleanStr(obj.sku    || ''),
      pack_size:   cleanStr(obj.pack_size || ''),
      cost:        cost.toFixed(2),
      expiry_date: expiry,
      invoice_ref: refName,
    });
  }
  return result;
}

// ── Plain-text heuristic parser ────────────────────────────────
function parseTextToRows(text, invoiceRef) {
  const refName = baseName(invoiceRef);
  const rows    = [];
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 2);
  const moneyRe  = /\$?\s*([\d]{1,6}[,.][\d]{2})\b|\b([\d]{1,6})\s*\.\s*([\d]{2})\b/;
  const skuRe    = /\b([A-Z0-9]{2,4}[-_\/][A-Z0-9]{2,10}(?:[-_\/][A-Z0-9]{1,6})*)\b/i;
  const packRe   = /\b(\d+\.?\d*\s*(?:kg|g|ml|L|ltr|litre|oz|lb|lbs|pcs|pk|pack|ct|units?|x\d+))\b/i;
  const dateRe   = /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})\b/;
  const skipPhrases = ['invoice','bill to','ship to','subtotal','sub total','gst','vat','tax',
    'total','balance','due','payment','account','page','date','order','po number','terms',
    'address','phone','email','fax','abn','acn','thank you','regards'];

  for (let i = 0; i < lines.length; i++) {
    const line  = lines[i];
    const lower = line.toLowerCase();
    if (skipPhrases.some(p => lower.startsWith(p) || lower === p)) continue;
    if (line.length < 3) continue;
    const moneyMatch = line.match(moneyRe);
    if (!moneyMatch) continue;
    let moneyStr = moneyMatch[0].replace(/[$\s]/g, '');
    const cost = parseFloat(moneyStr.replace(',', '.'));
    if (isNaN(cost) || cost <= 0 || cost > 999999) continue;
    let name = line
      .replace(moneyRe,  '')
      .replace(skuRe,    '')
      .replace(packRe,   '')
      .replace(dateRe,   '')
      .replace(/[^\w\s\-\/&'.,()]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    name = name.replace(/^\d+\s*[xX]?\s*/, '').replace(/\s*[xX]\s*\d+$/, '').trim();
    if (!name || name.length < 2) continue;
    const skuM  = line.match(skuRe);
    const packM = line.match(packRe);
    const dateM = line.match(dateRe);
    rows.push({
      name:        cleanStr(name),
      brand:       '',
      sku:         skuM  ? skuM[1]  : '',
      pack_size:   packM ? packM[1] : '',
      cost:        cost.toFixed(2),
      expiry_date: parseDate(dateM ? dateM[1] : ''),
      invoice_ref: refName,
    });
  }
  const seen = new Set();
  return rows.filter(r => {
    const key = r.name + '|' + r.cost;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

// ── Image parser — routes through the batch pipeline (enforces Azure) ──
// This used to call Vision directly; it now delegates to processImageBatch
// so Azure OCR is always the first step regardless of how a file arrives.
async function parseImage(file) {
  // stagedFiles is already populated by addFilesToStage before this is called.
  // Just hand off to the batch processor — it enforces Azure.
  await processImageBatch();
}

// ── CSV / Excel parsers (unchanged) ───────────────────────────
async function parseCSV(file) {
  showProgress(20, 'Reading CSV…');
  const text = await file.text();
  rawTextDebug = text;
  showProgress(60, 'Parsing columns…');
  extractedRows = parseCSVText(text, file.name);
  showProgress(100, 'Done!');
  finalizeParse(file.name);
}

async function parseExcel(file) {
  showProgress(20, 'Reading Excel…');
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  showProgress(60, 'Parsing sheet…');
  const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
  rawTextDebug = JSON.stringify(json, null, 2);
  extractedRows = mapSpreadsheetRows(json, file.name);
  showProgress(100, 'Done!');
  finalizeParse(file.name);
}

function parseCSVText(text, invoiceRef) {
  const lines   = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const refName = baseName(invoiceRef);
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cells = csvSplitLine(lines[i]).filter(c => c.trim());
    if (cells.length >= 3) { headerIdx = i; break; }
  }
  const rawHeader = csvSplitLine(lines[headerIdx]);
  const header    = rawHeader.map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, '_'));
  const alias = {
    name:        ['name','product','description','item','product_name','goods','service','detail'],
    brand:       ['brand','manufacturer','mfr','make','supplier'],
    sku:         ['sku','code','barcode','item_code','product_code','upc','ref','part_no','part'],
    pack_size:   ['pack_size','pack','size','unit_size','uom','pack_qty','qty_unit'],
    cost:        ['cost','price','unit_price','unit_cost','amount','rate','each','nett','excl','ex_gst'],
    expiry_date: ['expiry','expiry_date','best_before','bb','use_by','exp','best_before_date'],
    invoice_ref: ['invoice','invoice_ref','invoice_no','ref','reference','inv_no','inv'],
  };
  function findCol(key) {
    for (const a of alias[key]) { const i = header.indexOf(a); if (i !== -1) return i; }
    for (let i = 0; i < header.length; i++) {
      for (const a of alias[key]) { if (header[i].includes(a.replace(/_/g, ''))) return i; }
    }
    return -1;
  }
  const cols = {};
  Object.keys(alias).forEach(k => { cols[k] = findCol(k); });
  if (cols.name < 0) cols.name = header.findIndex(h => h.length > 0) ?? 0;
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = csvSplitLine(lines[i]);
    if (!cells.length) continue;
    const get  = idx => (idx >= 0 && idx < cells.length ? (cells[idx] || '').trim() : '');
    const name = get(cols.name);
    if (!name) continue;
    const costRaw = get(cols.cost).replace(/[$,\s]/g, '');
    const cost    = parseFloat(costRaw);
    rows.push({
      name,
      brand:       get(cols.brand),
      sku:         get(cols.sku),
      pack_size:   get(cols.pack_size),
      cost:        isNaN(cost) ? '0.00' : cost.toFixed(2),
      expiry_date: parseDate(get(cols.expiry_date)),
      invoice_ref: get(cols.invoice_ref) || refName,
    });
  }
  return rows;
}

function csvSplitLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

function mapSpreadsheetRows(json, invoiceRef) {
  const refName = baseName(invoiceRef);
  const alias = {
    name:        ['name','product','description','item','product name','goods','service','detail'],
    brand:       ['brand','manufacturer','mfr','make','supplier'],
    sku:         ['sku','code','barcode','item code','product code','upc','ref','part no'],
    pack_size:   ['pack size','pack_size','size','unit size','uom','pack'],
    cost:        ['cost','price','unit price','unit cost','amount','rate','each','nett','excl','ex gst'],
    expiry_date: ['expiry','expiry date','best before','bb','use by','exp','best_before'],
    invoice_ref: ['invoice','invoice ref','invoice no','ref','reference','inv no'],
  };
  function findKey(obj, field) {
    const keys = Object.keys(obj);
    const lows = keys.map(k => k.toLowerCase().trim().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' '));
    for (const a of alias[field]) { const i = lows.indexOf(a); if (i !== -1) return keys[i]; }
    for (let i = 0; i < lows.length; i++) {
      for (const a of alias[field]) { if (lows[i].includes(a)) return keys[i]; }
    }
    return null;
  }
  return json.map(row => {
    const get = f => { const k = findKey(row, f); return k != null ? String(row[k] ?? '').trim() : ''; };
    const name = get('name');
    if (!name) return null;
    const costRaw = get('cost').replace(/[$,\s]/g, '');
    const cost    = parseFloat(costRaw);
    return {
      name,
      brand:       get('brand'),
      sku:         get('sku'),
      pack_size:   get('pack_size'),
      cost:        isNaN(cost) ? '0.00' : cost.toFixed(2),
      expiry_date: parseDate(get('expiry_date')),
      invoice_ref: get('invoice_ref') || refName,
    };
  }).filter(Boolean);
}

// ══════════════════════════════════════════════════════════════
// RENDER EXTRACTED PREVIEW TABLE
// ══════════════════════════════════════════════════════════════
function renderExtractedTable() {
  const tbody = extractedBody();
  tbody.innerHTML = '';
  if (!extractedRows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">No items extracted.</td></tr>';
    return;
  }
  extractedRows.forEach((row, idx) => {
    const autoMappedBadge = row._auto_mapped
      ? '<span class="badge badge-info" style="margin-left:6px;font-size:0.75em">Auto\u2011mapped</span>'
      : '';
    const tr = document.createElement('tr');
    const lineTotal = ((parseFloat(row.qty) || 1) * (parseFloat(row.unit_price) || 0)).toFixed(2);
    tr.innerHTML = `
      <td><input type="text"   data-idx="${idx}" data-field="name"        value="${esc(row.name)}"        placeholder="Product name" />${autoMappedBadge}</td>
      <td><input type="text"   data-idx="${idx}" data-field="brand"       value="${esc(row.brand)}"       placeholder="Brand"        /></td>
      <td><input type="text"   data-idx="${idx}" data-field="sku"         value="${esc(row.sku)}"         placeholder="SKU"          /></td>
      <td><input type="text"   data-idx="${idx}" data-field="pack_size"   value="${esc(row.pack_size)}"   placeholder="e.g. 1 LB"   /></td>
      <td><input type="number" data-idx="${idx}" data-field="qty"         value="${esc(row.qty)}"         placeholder="1" step="any" style="width:60px" /></td>
      <td><input type="number" data-idx="${idx}" data-field="unit_price"  value="${esc(row.unit_price)}"  placeholder="0.00" step="0.01" style="width:80px" /></td>
      <td style="text-align:right;font-weight:600;white-space:nowrap" id="line-total-${idx}">$${lineTotal}</td>
      <td><input type="text"   data-idx="${idx}" data-field="invoice_ref" value="${esc(row.invoice_ref)}" placeholder="INV-001"      /></td>
      <td><button class="btn btn-danger btn-icon" onclick="removeExtractedRow(${idx})" title="Remove"><i class="fas fa-times"></i></button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx   = parseInt(e.target.dataset.idx);
      const field = e.target.dataset.field;
      extractedRows[idx][field] = e.target.value;
      if (field === 'qty' || field === 'unit_price') {
        const q = parseFloat(extractedRows[idx].qty) || 1;
        const u = parseFloat(extractedRows[idx].unit_price) || 0;
        extractedRows[idx].cost = (q * u).toFixed(2);
        const totalEl = document.getElementById(`line-total-${idx}`);
        if (totalEl) totalEl.textContent = '$' + (q * u).toFixed(2);
      }
    });
  });
}

function removeExtractedRow(idx) {
  extractedRows.splice(idx, 1);
  // Also remove from originalGptNames to keep indices in sync
  if (originalGptNames.length > idx) {
    originalGptNames.splice(idx, 1);
  }
  renderExtractedTable();
}

function emptyRow(ref = '') {
  return { name: '', brand: '', sku: '', pack_size: '', qty: 1, unit_price: '', cost: '', invoice_ref: ref };
}

// ══════════════════════════════════════════════════════════════
// POST-GPT VALIDATION
// Runs after GPT-4o returns its result and rows are mapped.
// Populates `invoiceFlags[]` with any issues found.
// Call before finalizeParse so the review screen can display flags.
// ══════════════════════════════════════════════════════════════

/**
 * @param {object} gptResult   — parsed GPT-4o JSON result
 * @param {string} ocrFullText — the full Azure OCR text (to detect page-count hints)
 * @param {number} uploadedPageCount — how many pages/files were actually uploaded
 */
function runValidation(gptResult, ocrFullText, uploadedPageCount) {
  invoiceFlags = [];

  const items       = Array.isArray(gptResult.items) ? gptResult.items : [];
  const total       = parseFloat(gptResult.total)          || 0;
  const taxGst      = parseFloat(gptResult.tax_gst)        || 0;
  const taxPst      = parseFloat(gptResult.tax_pst)        || 0;
  const delivery    = parseFloat(gptResult.delivery)       || 0;
  const fuelSurch   = parseFloat(gptResult.fuel_surcharge) || 0;
  const credit      = parseFloat(gptResult.credit)         || 0;
  const otherCost   = parseFloat(gptResult.other_cost)     || 0;

  // ── 1 & 2. Totals validation ───────────────────────────────
  const itemsSum = items.reduce((s, it) => s + (parseFloat(it.cost) || 0), 0);
  const charges  = taxGst + taxPst + delivery + fuelSurch + otherCost - credit;

  if (items.length > 0 && total > 0) {
    const tol = 1.00;
    const computedA = itemsSum + charges;
    const computedB = itemsSum + taxGst + taxPst - credit;
    const matchA = Math.abs(computedA - total) <= tol;
    const matchB = Math.abs(computedB - total) <= tol;

    if (!matchA && !matchB) {
      invoiceFlags.push({
        id: 'totals_match',
        message: `Computed total doesn't match invoice total $${total.toFixed(2)}. ` +
          `Tried charges-on-top: $${computedA.toFixed(2)} (items $${itemsSum.toFixed(2)} + charges $${charges.toFixed(2)}); ` +
          `tried charges-in-subtotal: $${computedB.toFixed(2)} (items $${itemsSum.toFixed(2)} + tax $${(taxGst + taxPst).toFixed(2)}). ` +
          `Needs review — totals don't match.`,
      });
    }
  }

  // ── 3. GPT-4o "needs review" fields ──────────────────────────
  const reviewPattern = /needs[\s_-]*review/i;
  function deepSearchNeedsReview(obj, path) {
    if (typeof obj === 'string' && reviewPattern.test(obj)) {
      invoiceFlags.push({
        id: 'gpt_needs_review_' + path,
        message: `GPT-4o flagged field "${path}" as needing review: "${obj}"`,
      });
    } else if (Array.isArray(obj)) {
      obj.forEach((v, i) => deepSearchNeedsReview(v, path + '[' + i + ']'));
    } else if (obj && typeof obj === 'object') {
      Object.entries(obj).forEach(([k, v]) => deepSearchNeedsReview(v, path ? path + '.' + k : k));
    }
  }
  deepSearchNeedsReview(gptResult, '');

  // ── 4. Missing pages detected from OCR text ──────────────────
  if (ocrFullText) {
    const pageOfMatch = ocrFullText.match(/\bpage\s+\d+\s+of\s+(\d+)\b/i);
    if (pageOfMatch) {
      const totalPages = parseInt(pageOfMatch[1], 10);
      if (!isNaN(totalPages) && totalPages > 1 && uploadedPageCount < totalPages) {
        invoiceFlags.push({
          id: 'missing_pages',
          message: `Invoice text mentions "${pageOfMatch[0]}" but only ${uploadedPageCount} page${uploadedPageCount === 1 ? '' : 's'} ${uploadedPageCount === 1 ? 'was' : 'were'} uploaded. Needs review — possible missing page.`,
        });
      }
    }
  }

  console.info(`[Validation] ${invoiceFlags.length} flag(s):`, invoiceFlags.map(f => f.id));
}

// ── Finalise parse: show results or fall back to manual ────────
function finalizeParse(fileName) {
  setTimeout(() => {
    hideProgress();
    if (extractedRows.length) {
      renderExtractedTable();
      extractedSec().classList.remove('hidden');
      document.getElementById('invoiceMeta').classList.remove('hidden');
      renderInvoiceImagePreview();
      const costsPanel = document.getElementById('invoiceCosts');
      if (costsPanel) costsPanel.classList.remove('hidden');

      if (invoiceFlags.length) {
        // Flagged — show banner, lock the save button
        renderValidationBanner();
        const saveBtn = document.getElementById('saveAllBtn');
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.title = 'Resolve all flags above before saving';
        }
        showToast(
          `⚠️ ${invoiceFlags.length} issue${invoiceFlags.length > 1 ? 's' : ''} found — review required before saving.`,
          'warning'
        );
      } else {
        hideValidationBanner();
        showToast(`✅ Extracted ${extractedRows.length} item(s) from ${stagedFiles.length > 1 ? stagedFiles.length + ' pages' : '1 page'}. Review and save.`, 'success');
      }
    } else {
      showDebugPanel(fileName);
      manualSec().classList.remove('hidden');
      document.getElementById('invoiceMeta').classList.remove('hidden');
      renderInvoiceImagePreview();
      const costsPanel = document.getElementById('invoiceCosts');
      if (costsPanel) costsPanel.classList.remove('hidden');
      addManualRow();
      showToast('Could not auto-extract items. See debug panel below & enter manually.', 'warning');
    }
    // Always render Azure OCR panel if we have data (regardless of extraction success)
    if (azureOcrPages.length) renderOcrPanel();
    // Always render GPT-4o raw panel if we have data
    if (gptRawPages.length) renderGptPanel();
  }, 400);
}

// ── Render / hide the validation flag banner ───────────────────
function renderValidationBanner() {
  // Remove any previous banner
  const old = document.getElementById('validationBanner');
  if (old) old.remove();

  const banner = document.createElement('div');
  banner.id = 'validationBanner';
  banner.className = 'validation-banner';

  const flagsHtml = invoiceFlags.map(f => `
    <div class="vflag-item">
      <i class="fas fa-exclamation-triangle vflag-icon"></i>
      <span>${esc(f.message)}</span>
    </div>
  `).join('');

  banner.innerHTML = `
    <div class="vbanner-header">
      <div class="vbanner-title">
        <i class="fas fa-clipboard-check"></i>
        ${invoiceFlags.length} Issue${invoiceFlags.length > 1 ? 's' : ''} Found — Review Required Before Saving
      </div>
      <button class="vbanner-approve-btn" id="approveFlagsBtn" title="Approve and save anyway">
        <i class="fas fa-check"></i> Approve &amp; Save Anyway
      </button>
    </div>
    <div class="vflag-list">${flagsHtml}</div>
    <p class="vbanner-note">
      Correct any issues in the table above, then click <strong>Approve &amp; Save Anyway</strong> to save,
      or fix the issues (they will re-validate on the next upload).
    </p>
  `;

  // Insert banner directly above the extracted section
  const extSec = extractedSec();
  if (extSec && extSec.parentNode) {
    extSec.parentNode.insertBefore(banner, extSec);
  }

  // Wire the approve button — clears flags and enables Save
  document.getElementById('approveFlagsBtn').addEventListener('click', () => {
    invoiceFlags = [];
    hideValidationBanner();
    const saveBtn = document.getElementById('saveAllBtn');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.title = '';
    }
    showToast('Issues acknowledged — you can now save.', 'info');
  });
}

function hideValidationBanner() {
  const banner = document.getElementById('validationBanner');
  if (banner) banner.remove();
}

// ══════════════════════════════════════════════════════════════
// INVOICE IMAGE PREVIEW
// ══════════════════════════════════════════════════════════════
function renderInvoiceImagePreview() {
  const section = document.getElementById('invoiceImagePreview');
  const container = document.getElementById('invoiceImageContainer');
  if (!section || !container) return;

  container.innerHTML = '';

  const imageFiles = stagedFiles.filter(sf => sf.type === 'img');
  const pdfFiles = stagedFiles.filter(sf => sf.type === 'pdf');

  if (imageFiles.length) {
    imageFiles.forEach((sf, idx) => {
      if (sf.thumbUrl) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin-bottom:0.75rem;';
        if (imageFiles.length > 1) {
          const label = document.createElement('div');
          label.style.cssText = 'font-size:.82rem;font-weight:600;color:#475569;margin-bottom:.35rem;';
          label.textContent = 'Page ' + (idx + 1) + ' — ' + sf.file.name;
          wrapper.appendChild(label);
        }
        const img = document.createElement('img');
        img.src = sf.thumbUrl;
        img.style.cssText = 'max-width:100%;border-radius:8px;border:1px solid #e2e8f0;';
        img.alt = 'Invoice page ' + (idx + 1);
        wrapper.appendChild(img);
        container.appendChild(wrapper);
      }
    });
    section.classList.remove('hidden');
  } else if (pdfFiles.length) {
    const note = document.createElement('div');
    note.style.cssText = 'padding:1.5rem;color:#64748b;font-size:.9rem;';
    note.innerHTML = '<i class="fas fa-file-pdf" style="color:#dc2626;margin-right:.5rem;font-size:1.2rem;"></i> PDF uploaded — image preview not available for PDFs. Use the Raw OCR Output panel below to verify extracted text.';
    container.appendChild(note);
    section.classList.remove('hidden');
  }
}

// ══════════════════════════════════════════════════════════════
// DEBUG PANEL
// ══════════════════════════════════════════════════════════════
function showDebugPanel(fileName) {
  let panel = document.getElementById('debugPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'debugPanel';
    panel.style.cssText = `
      margin-top:1.5rem; border:2px solid #f59e0b; border-radius:10px;
      background:#fffbeb; overflow:hidden;
    `;
    const uploadCard = document.querySelector('.upload-card');
    uploadCard.parentNode.insertBefore(panel, uploadCard.nextSibling);
  }
  const preview = rawTextDebug
    ? rawTextDebug.substring(0, 3000) + (rawTextDebug.length > 3000 ? '\n…(truncated)' : '')
    : '(no text could be extracted — file may be a scanned image or password-protected)';
  panel.innerHTML = `
    <div style="padding:.75rem 1.25rem; background:#fef3c7; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #fbbf24;">
      <strong style="color:#92400e;"><i class="fas fa-bug"></i> Debug — Raw Extracted Text from "${esc(fileName)}"</strong>
      <button onclick="hideDebugPanel()" style="background:none;border:none;cursor:pointer;color:#92400e;font-size:1rem;"><i class="fas fa-times"></i></button>
    </div>
    <div style="padding:1rem 1.25rem;">
      <p style="font-size:.82rem;color:#78350f;margin-bottom:.75rem;">
        The parser could not find product lines. The raw text below is what was read from your file.
        Use it to check if the file has extractable text, or if the column names match expectations.
      </p>
      <div style="display:flex;gap:.5rem;margin-bottom:.75rem;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" onclick="retryWithAllLines()"><i class="fas fa-redo"></i> Force-import all lines with prices</button>
        <button class="btn btn-secondary btn-sm" onclick="copyDebugText()"><i class="fas fa-copy"></i> Copy raw text</button>
      </div>
      <pre id="debugText" style="background:#1e293b;color:#e2e8f0;padding:1rem;border-radius:8px;font-size:.75rem;overflow:auto;max-height:300px;white-space:pre-wrap;word-break:break-word;">${esc(preview)}</pre>
    </div>
  `;
}

function hideDebugPanel() {
  const p = document.getElementById('debugPanel');
  if (p) p.remove();
}

function copyDebugText() {
  navigator.clipboard?.writeText(rawTextDebug)
    .then(() => showToast('Raw text copied to clipboard!', 'success'))
    .catch(() => showToast('Copy failed — select text manually.', 'warning'));
}

function retryWithAllLines() {
  if (!rawTextDebug) { showToast('No raw text available.', 'error'); return; }
  const moneyRe = /\$?\s*\d{1,6}[.,]\d{2}/;
  const lines   = rawTextDebug.split(/\n/).map(l => l.trim()).filter(l => l.length > 2 && moneyRe.test(l));
  if (!lines.length) { showToast('No lines with prices found in the raw text.', 'error'); return; }
  extractedRows = lines.map((line, i) => ({
    name:        line.replace(/\$?\d{1,6}[.,]\d{2}/g, '').replace(/\s+/g,' ').trim() || `Item ${i+1}`,
    brand:       '',
    sku:         '',
    pack_size:   '',
    cost:        (line.match(/\$?\s*(\d{1,6}[.,]\d{2})/)?.[1] || '0').replace(',','.').replace('$',''),
    expiry_date: '',
    invoice_ref: '',
  }));
  renderExtractedTable();
  extractedSec().classList.remove('hidden');
  manualSec().classList.add('hidden');
  showToast(`Force-imported ${extractedRows.length} line(s). Please review carefully.`, 'warning');
}

// ══════════════════════════════════════════════════════════════
// CREATE INVOICE RECORD
// ══════════════════════════════════════════════════════════════
async function createInvoiceRecord({ vendor, invoiceNumber, invoiceDate, total, fileName, fileKey, fileUrl,
  taxGst = 0, taxPst = 0, delivery = 0, fuelSurcharge = 0, credit = 0, otherCost = 0, otherDesc = '', lines = [] }) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    let record;
    const extraCosts = {
      tax_gst:        parseFloat(taxGst)        || 0,
      tax_pst:        parseFloat(taxPst)        || 0,
      delivery:       parseFloat(delivery)      || 0,
      fuel_surcharge: parseFloat(fuelSurcharge) || 0,
      credit:         parseFloat(credit)        || 0,
      other_cost:     parseFloat(otherCost)     || 0,
      other_desc:     otherDesc || '',
    };
    if (fileKey) {
      const ensured = await apiPost('ensure-invoice', {
        file_key:       fileKey,
        file_name:      fileName || '',
        vendor:         vendor   || '',
        invoice_number: invoiceNumber || '',
        invoice_date:   invoiceDate   || today,
        total:          parseFloat(total) || 0,
        ...extraCosts,
      });
      record = { id: ensured.id };
      await apiPatch(`tables/invoices/${ensured.id}`, {
        vendor:         vendor         || '',
        invoice_number: invoiceNumber  || '',
        invoice_date:   invoiceDate    || today,
        total:          parseFloat(total) || 0,
        file_url:       fileUrl || `/api/files/${fileKey}`,
        ...extraCosts,
      });
    } else {
      record = await apiPost('tables/invoices', {
        vendor:          vendor        || '',
        invoice_number:  invoiceNumber || '',
        invoice_date:    invoiceDate   || today,
        upload_date:     today,
        total:           parseFloat(total) || 0,
        status:          'In Processing',
        payment_account: 'A/P',
        file_name:       fileName || '',
        file_key:        fileKey  || '',
        file_url:        fileUrl  || '',
        notes:           '',
        ...extraCosts,
      });
    }
    if (lines.length && record.id) {
      await apiPost(`invoice-lines/${record.id}/replace`, {
        lines,
        tax_gst:        parseFloat(taxGst)        || 0,
        tax_pst:        parseFloat(taxPst)        || 0,
        delivery:       parseFloat(delivery)      || 0,
        fuel_surcharge: parseFloat(fuelSurcharge) || 0,
        credit:         parseFloat(credit)        || 0,
        other_cost:     parseFloat(otherCost)     || 0,
        other_desc:     otherDesc || '',
      });
    }
    return record;
  } catch (e) {
    console.warn('createInvoiceRecord failed:', e.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
// SAVE EXTRACTED ROWS
// ══════════════════════════════════════════════════════════════
async function saveExtractedRows() {
  const inputs = extractedBody().querySelectorAll('input');
  inputs.forEach(inp => {
    const idx   = parseInt(inp.dataset.idx);
    const field = inp.dataset.field;
    if (!isNaN(idx) && field && extractedRows[idx]) extractedRows[idx][field] = inp.value;
  });

  const valid = extractedRows.filter(r => r && r.name && r.name.trim());
  if (!valid.length) { showToast('No valid rows to save.', 'error'); return; }

  const btn = document.getElementById('saveAllBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  const vendorName    = document.getElementById('metaVendor')?.value.trim()      || '';
  const invoiceNumber = document.getElementById('metaInvoiceNum')?.value.trim()  || '';
  const invoiceDate   = document.getElementById('metaInvoiceDate')?.value         || '';
  const invoiceTotal  = document.getElementById('metaTotal')?.value               || 0;

  // Read Additional Costs from the visible fields (user may have corrected them)
  currentTaxGst        = parseFloat(document.getElementById('metaTaxGst')?.value)        || 0;
  currentTaxPst        = parseFloat(document.getElementById('metaTaxPst')?.value)        || 0;
  currentDelivery      = parseFloat(document.getElementById('metaDelivery')?.value)      || 0;
  currentFuelSurcharge = parseFloat(document.getElementById('metaFuelSurcharge')?.value) || 0;
  currentCredit        = parseFloat(document.getElementById('metaCredit')?.value)        || 0;
  currentOtherCost     = parseFloat(document.getElementById('metaOtherCost')?.value)     || 0;
  currentOtherDesc     = document.getElementById('metaOtherDesc')?.value?.trim()         || '';

  const invLines = valid.map(r => ({
    product_name: r.name      || '',
    vendor_item:  r.name      || '',
    category:     r.brand     || '',
    item_code:    r.sku       || '',
    packaging:    r.pack_size || '',
    price:        parseFloat(r.unit_price) || 0,
    qty:          parseFloat(r.qty) || 1,
    line_total:   parseFloat(r.cost) || 0,
  }));

  const invRecord = await createInvoiceRecord({
    vendor:        vendorName,
    invoiceNumber,
    invoiceDate,
    total:         invoiceTotal,
    fileName:      currentFileName,
    fileKey:       currentFileKey,
    fileUrl:       currentFileUrl,
    taxGst:        currentTaxGst,
    taxPst:        currentTaxPst,
    delivery:      currentDelivery,
    fuelSurcharge: currentFuelSurcharge,
    credit:        currentCredit,
    otherCost:     currentOtherCost,
    otherDesc:     currentOtherDesc,
    lines:         invLines,
  });
  if (typeof loadInvoices === 'function') { try { await loadInvoices(); } catch(_) {} }

  const invoiceId = invRecord?.id || '';
  const validWithInv = valid.map(r => ({
    ...r,
    invoice_id:        invoiceId,
    invoice_file_key:  currentFileKey  || '',
    invoice_file_name: currentFileName || '',
    invoice_ref:       r.invoice_ref || invoiceNumber || '',
  }));

  const result = await bulkSaveProducts(validWithInv, vendorName);

  // ── Save product mappings using Azure OCR text as the key ───
  if (vendorName) {
    for (let i = 0; i < valid.length; i++) {
      const rawOcr = valid[i]._original_ocr || originalGptNames[i] || '';
      const correctedName = (valid[i].name || '').trim();
      if (rawOcr && correctedName) {
        try {
          await apiPost('product-mappings', {
            vendor_name:        vendorName,
            raw_ocr_text:       rawOcr,
            corrected_name:     correctedName,
            corrected_brand:    valid[i].brand    || '',
            corrected_sku:      valid[i].sku      || '',
            corrected_pack_size: valid[i].pack_size || '',
          });
        } catch (e) {
          console.warn('Failed to save mapping for:', rawOcr, e.message);
        }
      }
    }
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-save"></i> Save All to Database';

  const newCount     = result.created_generics || 0;
  const updatedCount = result.reused_generics  || 0;
  const toastParts = [];
  if (result.supplier_created) toastParts.push(`New vendor "${result.supplier_name}" created`);
  if (newCount)                toastParts.push(`${newCount} new product(s) added`);
  if (updatedCount)            toastParts.push(`${updatedCount} existing product(s) updated`);
  showToast(toastParts.join(' · ') || 'Saved!', 'success');
  extractedSec().classList.add('hidden');

  openInvPrompt(valid);

  extractedRows = [];
  hideDebugPanel();
  await loadProducts();
}

// ══════════════════════════════════════════════════════════════
// MANUAL ENTRY ROWS
// ══════════════════════════════════════════════════════════════
let manualRowCount = 0;
function addManualRow() {
  const idx = manualRowCount++;
  const div = document.createElement('div');
  div.className = 'manual-row';
  div.id = `mrow-${idx}`;
  div.innerHTML = `
    <div class="form-group"><label>Product Name *</label><input type="text"   id="mname-${idx}"  placeholder="e.g. Olive Oil" /></div>
    <div class="form-group"><label>Brand</label>         <input type="text"   id="mbrand-${idx}" placeholder="e.g. Brand"     /></div>
    <div class="form-group"><label>SKU</label>           <input type="text"   id="msku-${idx}"   placeholder="e.g. SKU-001"   /></div>
    <div class="form-group"><label>Pack Size *</label>
      <div class="pack-size-row">
        <input type="number" id="mpackqty-${idx}" placeholder="e.g. 500" min="0" step="any" />
        <select id="mpackunit-${idx}">
          <option value="kg">kg</option><option value="g">g</option><option value="lb">lb</option>
          <option value="ml">ml</option><option value="L">L</option><option value="Can">Can</option>
          <option value="Each">Each</option><option value="Pack">Pack</option>
          <option value="Case">Case</option><option value="Dozen">Dozen</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label>Cost ($)</label>      <input type="number" id="mcost-${idx}"  placeholder="0.00" step="0.01"/></div>
    <div class="form-group"><label>Expiry Date</label>   <input type="date"   id="mexpiry-${idx}"                             /></div>
    <div class="form-group"><label>Invoice Ref</label>   <input type="text"   id="mref-${idx}"   placeholder="INV-001"        /></div>
    <button class="btn btn-danger btn-icon" style="margin-bottom:.15rem" onclick="removeManualRow(${idx})" title="Remove"><i class="fas fa-times"></i></button>
  `;
  manualRows().appendChild(div);
}

function removeManualRow(idx) {
  const el = document.getElementById(`mrow-${idx}`);
  if (el) el.remove();
}

async function saveManualRows() {
  const rows = [];
  manualRows().querySelectorAll('.manual-row').forEach(div => {
    const idx      = parseInt(div.id.replace('mrow-',''));
    const name     = (document.getElementById(`mname-${idx}`)?.value  || '').trim();
    const brand    = (document.getElementById(`mbrand-${idx}`)?.value || '').trim();
    const sku      = (document.getElementById(`msku-${idx}`)?.value   || '').trim();
    const packQty  = (document.getElementById(`mpackqty-${idx}`)?.value  || '').trim();
    const packUnit = (document.getElementById(`mpackunit-${idx}`)?.value || 'kg').trim();
    const pack     = packQty ? `${packQty} ${packUnit}` : '';
    const cost     = parseFloat(document.getElementById(`mcost-${idx}`)?.value || '0');
    const expiry   = (document.getElementById(`mexpiry-${idx}`)?.value || '').trim();
    const ref      = (document.getElementById(`mref-${idx}`)?.value   || '').trim();
    if (name) rows.push({ name, brand, sku, pack_size: pack, cost: isNaN(cost)?0:cost, expiry_date: expiry, invoice_ref: ref });
  });

  if (!rows.length) { showToast('No valid rows to save.', 'error'); return; }
  const btn = document.getElementById('saveManualBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  const vendorNameM    = document.getElementById('metaVendor')?.value.trim()      || '';
  const invoiceNumberM = document.getElementById('metaInvoiceNum')?.value.trim()  || '';
  const invoiceDateM   = document.getElementById('metaInvoiceDate')?.value         || '';
  const invoiceTotalM  = document.getElementById('metaTotal')?.value               || 0;

  // Read Additional Costs from the visible fields (user may have corrected them)
  currentTaxGst        = parseFloat(document.getElementById('metaTaxGst')?.value)        || 0;
  currentTaxPst        = parseFloat(document.getElementById('metaTaxPst')?.value)        || 0;
  currentDelivery      = parseFloat(document.getElementById('metaDelivery')?.value)      || 0;
  currentFuelSurcharge = parseFloat(document.getElementById('metaFuelSurcharge')?.value) || 0;
  currentCredit        = parseFloat(document.getElementById('metaCredit')?.value)        || 0;
  currentOtherCost     = parseFloat(document.getElementById('metaOtherCost')?.value)     || 0;
  currentOtherDesc     = document.getElementById('metaOtherDesc')?.value?.trim()         || '';

  const manualLines = rows.map(r => ({
    product_name: r.name      || '',
    vendor_item:  r.name      || '',
    category:     r.brand     || '',
    item_code:    r.sku       || '',
    packaging:    r.pack_size || '',
    price:        parseFloat(r.unit_price) || parseFloat(r.cost) || 0,
    qty:          parseFloat(r.qty) || 1,
    line_total:   parseFloat(r.cost) || 0,
  }));

  const invRecordM = await createInvoiceRecord({
    vendor:        vendorNameM,
    invoiceNumber: invoiceNumberM,
    invoiceDate:   invoiceDateM,
    total:         invoiceTotalM,
    fileName:      currentFileName,
    fileKey:       currentFileKey,
    fileUrl:       currentFileUrl,
    taxGst:        currentTaxGst,
    taxPst:        currentTaxPst,
    delivery:      currentDelivery,
    fuelSurcharge: currentFuelSurcharge,
    credit:        currentCredit,
    otherCost:     currentOtherCost,
    otherDesc:     currentOtherDesc,
    lines:         manualLines,
  });
  if (typeof loadInvoices === 'function') { try { await loadInvoices(); } catch(_) {} }

  const invoiceIdM = invRecordM?.id || '';
  const rowsWithInv = rows.map(r => ({
    ...r,
    invoice_id:        invoiceIdM,
    invoice_file_key:  currentFileKey  || '',
    invoice_file_name: currentFileName || '',
    invoice_ref:       r.invoice_ref || invoiceNumberM || '',
  }));

  const result = await bulkSaveProducts(rowsWithInv, vendorNameM);
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-save"></i> Save All to Database';

  const newCount     = result.created_generics || 0;
  const updatedCount = result.reused_generics  || 0;
  const toastParts = [];
  if (result.supplier_created) toastParts.push(`New vendor "${result.supplier_name}" created`);
  if (newCount)                toastParts.push(`${newCount} new product(s) added`);
  if (updatedCount)            toastParts.push(`${updatedCount} existing product(s) updated`);
  showToast(toastParts.join(' · ') || 'Saved!', 'success');
  manualSec().classList.add('hidden');

  openInvPrompt(rows);
  manualRows().innerHTML = '';
  manualRowCount = 0;
  hideDebugPanel();
  await loadProducts();
}

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════
function parseMoney(str) {
  if (!str) return NaN;
  const s = String(str).replace(/[^0-9.,]/g, '');
  if (/^\d{1,3}(,\d{3})*\.\d{2}$/.test(s)) return parseFloat(s.replace(/,/g, ''));
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return parseFloat(s.replace(',', '.'));
}

function parseDate(str) {
  if (!str) return '';
  try {
    const norm = str.trim().replace(/\./g, '/');
    const d    = new Date(norm);
    if (!isNaN(d) && d.getFullYear() > 1980) return d.toISOString().split('T')[0];
    const parts = norm.split(/[\/\-]/);
    if (parts.length === 3) {
      let [a, b, c] = parts;
      if (c.length === 2) c = '20' + c;
      const asISO = parseInt(a) > 12
        ? `${c}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`
        : `${c}-${a.padStart(2,'0')}-${b.padStart(2,'0')}`;
      const d2 = new Date(asISO);
      if (!isNaN(d2)) return d2.toISOString().split('T')[0];
    }
  } catch (_) {}
  return '';
}

function cleanStr(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function baseName(fileName) { return (fileName || '').replace(/\.[^.]+$/, ''); }

function showProgress(pct, msg) {
  parseProgress().classList.remove('hidden');
  progressBar().style.width = pct + '%';
  parseStatus().textContent = msg;
}
function hideProgress() {
  setTimeout(() => parseProgress().classList.add('hidden'), 600);
}

// ══════════════════════════════════════════════════════════════
// INVENTORY PROMPT
// ══════════════════════════════════════════════════════════════
let invPromptRows = [];

function openInvPrompt(rows) {
  if (!rows || !rows.length) return;
  if (!document.getElementById('invPromptModal')) return;

  invPromptRows = rows.filter(r => r.name);
  const listEl = document.getElementById('invPromptList');
  listEl.innerHTML = invPromptRows.map((r, i) => {
    const packSize = r.pack_size || '';
    const unitMatch = packSize.match(/[\d.]+\s*(.+)$/);
    const unit = unitMatch ? unitMatch[1].trim() : 'unit';
    return `
      <div class="inv-prompt-row" style="display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-bottom:1px solid var(--border)">
        <input type="checkbox" id="inv-chk-${i}" checked style="width:16px;height:16px;cursor:pointer" />
        <div style="flex:1">
          <div style="font-weight:600;font-size:.9rem">${esc(r.name)}${r.brand ? ' — ' + esc(r.brand) : ''}</div>
          <div style="font-size:.78rem;color:var(--text-muted)">${packSize}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.4rem">
          <input type="number" id="inv-qty-${i}" value="1" min="0.001" step="0.001"
            style="width:80px;padding:.3rem .5rem;border:1px solid var(--border);border-radius:6px;font-size:.85rem;text-align:right" />
          <span style="font-size:.82rem;color:var(--text-muted)">${esc(unit)}</span>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('skipInvPromptBtn').onclick    = () => closeModal('invPromptModal');
  document.getElementById('closeInvPromptModal').onclick = () => closeModal('invPromptModal');
  document.getElementById('confirmInvPromptBtn').onclick = confirmInvPrompt;
  openModal('invPromptModal');
}

async function confirmInvPrompt() {
  const btn = document.getElementById('confirmInvPromptBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding…';

  let savedProducts = [];
  try {
    const data = await apiGet('tables/generic_products?page=1&limit=500');
    savedProducts = data.data || [];
  } catch (_) {}

  let added = 0;
  for (let i = 0; i < invPromptRows.length; i++) {
    const chk = document.getElementById(`inv-chk-${i}`);
    if (!chk?.checked) continue;
    const qty = parseFloat(document.getElementById(`inv-qty-${i}`)?.value) || 1;
    const row = invPromptRows[i];
    const match = savedProducts
      .filter(p => p.name === row.name)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
    const packSize = row.pack_size || '';
    const unitMatch = packSize.match(/[\d.]+\s*(.+)$/);
    const unit = unitMatch ? unitMatch[1].trim() : 'unit';
    if (match && window.invHelpers) {
      try {
        await window.invHelpers.upsertInventory({
          itemId:   match.id,
          itemType: 'raw_material',
          itemName: match.name,
          category: match.category || 'Ingredients',
          unit,
          change:   qty,
          reason:   `Invoice stock-in: ${row.invoice_ref || 'manual'}`,
        });
        added++;
      } catch (_) {}
    }
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-warehouse"></i> Add to Inventory';
  closeModal('invPromptModal');
  showToast(`${added} item(s) added to inventory!`, 'success');
}
