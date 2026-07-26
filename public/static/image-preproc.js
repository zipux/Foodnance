// ══════════════════════════════════════════════════════════════
// SHARED IMAGE PREPROCESSING
// Quality-gates and normalises a photographed invoice page before it is sent
// to /api/ai/parse-invoice. Extracted from invoice.js so BOTH parse paths can
// use it: the main upload page (upload-invoice.html) and the "add a page"
// button on the invoice detail modal (invoices.html). Previously only the
// upload page preprocessed, so a page added from the modal could be blurrier
// than one the upload page would have rejected outright.
//
// Exposes: PREPROC (tunables) + preprocessImage(file) -> { file, rejected,
// reason, warnings, metrics }. Callers own their own UI for rejections.
//
// MAX_LONG_SIDE_PX is a COST control as well as a quality one: Claude's
// high-resolution vision tier caps at 2576px on the long edge, so anything
// larger is downscaled server-side anyway — you pay the same image tokens and
// upload more bytes for no accuracy gain. Do not raise it above 2576 without
// re-checking that cap.
// Runs automatically on every image before it is read.
// PDFs are skipped here.
// ══════════════════════════════════════════════════════════════
const PREPROC = {
  MIN_SHORT_SIDE_PX : 900,
  MIN_AVG_BRIGHTNESS: 30,
  MAX_AVG_BRIGHTNESS: 245,
  MIN_BLUR_VARIANCE : 80,
  MAX_LONG_SIDE_PX  : 2576,   // Claude's high-res vision cap — see note above
  JPEG_QUALITY      : 0.88,
  MAX_FILE_BYTES    : 10 * 1024 * 1024,
};

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot decode image: ' + file.name)); };
    img.src = url;
  });
}

function imageToCanvas(img, scale = 1) {
  const w = Math.round(img.naturalWidth  * scale);
  const h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c;
}

function getPixels(canvas) {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
}

function toGrayscale(pixels) {
  const gray = new Float32Array(pixels.width * pixels.height);
  const d    = pixels.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
  }
  return gray;
}

function avgBrightness(gray) {
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  return sum / gray.length;
}

function laplacianVariance(gray, w, h) {
  const scale = Math.min(1, 400 / Math.max(w, h));
  const sw    = Math.max(1, Math.round(w * scale));
  const sh    = Math.max(1, Math.round(h * scale));
  const sub = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const sx = Math.round(x / scale);
      const sy = Math.round(y / scale);
      sub[y * sw + x] = gray[Math.min(sy, h-1) * w + Math.min(sx, w-1)];
    }
  }
  let sumSq = 0, count = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const c = sub[y * sw + x];
      const lap = sub[(y-1) * sw + x] + sub[(y+1) * sw + x] +
                  sub[y * sw + (x-1)] + sub[y * sw + (x+1)] - 4 * c;
      sumSq += lap * lap;
      count++;
    }
  }
  if (!count) return 0;
  const mean = sumSq / count;
  return mean;
}

function enhanceContrast(canvas) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  // Histogram stretch on luminance
  let minV = 255, maxV = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const range = maxV - minV || 1;
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = Math.max(0, Math.min(255, ((d[i]   - minV) / range) * 255));
    d[i+1] = Math.max(0, Math.min(255, ((d[i+1] - minV) / range) * 255));
    d[i+2] = Math.max(0, Math.min(255, ((d[i+2] - minV) / range) * 255));
  }
  ctx.putImageData(img, 0, 0);
}

function detectSkewAngle(gray, w, h) {
  // Simple Hough transform on edge pixels for skew detection.
  // Returns angle in degrees [-15, 15]; 0 if undetectable.
  const scale = Math.min(1, 400 / Math.max(w, h));
  const sw    = Math.max(1, Math.round(w * scale));
  const sh    = Math.max(1, Math.round(h * scale));
  const sub = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const sx = Math.round(x / scale);
      const sy = Math.round(y / scale);
      sub[y * sw + x] = gray[Math.min(sy, h-1) * w + Math.min(sx, w-1)];
    }
  }
  // Threshold edges (Sobel-ish gradient)
  const edges = [];
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const gx = sub[y*sw + (x+1)] - sub[y*sw + (x-1)];
      const gy = sub[(y+1)*sw + x] - sub[(y-1)*sw + x];
      const m  = Math.abs(gx) + Math.abs(gy);
      if (m > 60) edges.push([x, y]);
    }
  }
  if (edges.length < 50) return 0;
  // Sample subset for speed
  const sample = edges.length > 4000 ? edges.filter((_, i) => i % Math.ceil(edges.length / 4000) === 0) : edges;
  // Hough accumulator for angles -15..15 in 0.5° steps
  const angleStep = 0.5;
  const angles = [];
  for (let a = -15; a <= 15; a += angleStep) angles.push(a);
  const buckets = new Array(angles.length).fill(0);
  // Just count near-horizontal alignment by projecting edge points onto the angle's normal
  // (very lightweight skew detection — good enough to find dominant text rotation)
  for (const [x, y] of sample) {
    for (let i = 0; i < angles.length; i++) {
      const rad = angles[i] * Math.PI / 180;
      const proj = Math.round(x * Math.sin(rad) + y * Math.cos(rad));
      buckets[i] += 1 / (1 + (proj % 8 === 0 ? 0 : 1));
    }
  }
  let best = 0, bestVal = 0;
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i] > bestVal) { bestVal = buckets[i]; best = i; }
  }
  return angles[best];
}

function rotateCanvas(canvas, angleDeg) {
  const rad = angleDeg * Math.PI / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const w = canvas.width;
  const h = canvas.height;
  const newW = Math.round(w * cos + h * sin);
  const newH = Math.round(w * sin + h * cos);
  const c = document.createElement('canvas');
  c.width = newW; c.height = newH;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, newW, newH);
  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -w / 2, -h / 2);
  return c;
}

function canvasToFile(canvas, name, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) return reject(new Error('toBlob failed'));
      resolve(new File([blob], (name || 'photo.jpg').replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
    }, 'image/jpeg', quality);
  });
}

async function preprocessImage(file) {
  let img;
  try {
    img = await loadImageFromFile(file);
  } catch (_) {
    return { file, rejected: true, reason: 'Cannot decode image — it may be corrupted.', warnings: [], metrics: {} };
  }

  const origW = img.naturalWidth;
  const origH = img.naturalHeight;
  const shortSide = Math.min(origW, origH);

  let canvas = imageToCanvas(img, 1);
  const pixels = getPixels(canvas);
  const gray   = toGrayscale(pixels);
  const bright = avgBrightness(gray);
  const blur   = laplacianVariance(gray, origW, origH);
  const metrics = { width: origW, height: origH, brightness: Math.round(bright), blurVariance: Math.round(blur) };

  if (shortSide < PREPROC.MIN_SHORT_SIDE_PX) {
    return { file, rejected: true, reason:
      `Resolution too low (${origW}×${origH}px — shortest side ${shortSide}px, minimum ${PREPROC.MIN_SHORT_SIDE_PX}px). Please re-scan or re-photograph at a higher resolution.`,
      warnings: [], metrics };
  }
  if (bright < PREPROC.MIN_AVG_BRIGHTNESS) {
    return { file, rejected: true, reason:
      `Image is too dark (brightness ${Math.round(bright)}/255, minimum ${PREPROC.MIN_AVG_BRIGHTNESS}). Please re-photograph with better lighting.`,
      warnings: [], metrics };
  }
  if (bright > PREPROC.MAX_AVG_BRIGHTNESS) {
    return { file, rejected: true, reason:
      `Image is overexposed (brightness ${Math.round(bright)}/255, maximum ${PREPROC.MAX_AVG_BRIGHTNESS}). Please reduce glare and re-photograph.`,
      warnings: [], metrics };
  }
  if (blur < PREPROC.MIN_BLUR_VARIANCE) {
    return { file, rejected: true, reason:
      `Image is too blurry (sharpness score ${Math.round(blur)}, minimum ${PREPROC.MIN_BLUR_VARIANCE}). Hold steady and ensure text is in focus.`,
      warnings: [], metrics };
  }

  const warnings = [];

  const longSide = Math.max(origW, origH);
  if (longSide > PREPROC.MAX_LONG_SIDE_PX) {
    const scale = PREPROC.MAX_LONG_SIDE_PX / longSide;
    canvas = imageToCanvas(img, scale);
    warnings.push(`Resized from ${origW}×${origH} to ${canvas.width}×${canvas.height}px`);
  }

  enhanceContrast(canvas);

  const resizedPixels = getPixels(canvas);
  const resizedGray   = toGrayscale(resizedPixels);
  const skewAngle     = detectSkewAngle(resizedGray, canvas.width, canvas.height);
  if (Math.abs(skewAngle) >= 0.3) {
    canvas = rotateCanvas(canvas, skewAngle);
    warnings.push(`Deskewed ${skewAngle.toFixed(1)}°`);
  }

  let quality = PREPROC.JPEG_QUALITY;
  let outFile = await canvasToFile(canvas, file.name, quality);
  while (outFile.size > PREPROC.MAX_FILE_BYTES && quality > 0.5) {
    quality = Math.round((quality - 0.08) * 100) / 100;
    outFile = await canvasToFile(canvas, file.name, quality);
  }
  if (outFile.size > PREPROC.MAX_FILE_BYTES) {
    warnings.push(`Compressed file is still ${(outFile.size / 1024 / 1024).toFixed(1)} MB — may be rejected (30 MB max per file).`);
  }

  return { file: outFile, rejected: false, reason: '', warnings, metrics };
}
