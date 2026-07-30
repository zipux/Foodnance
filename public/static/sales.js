// ===== sales.js — POS sales import =====
//
// Upload → parse (locally, pos-parse.js) → save a draft → review and map → commit.
// The same shape as the invoice flow, and for the same reason: the mapping step
// needs to survive a refresh, so the parsed file is stashed server-side as a
// draft rather than held in this page's memory.

let posImports    = [];   // the list
let posDraft      = null; // { import_id, items, ... } while reviewing
let posLinkTarget = null; // index into posDraft.items being linked
let posLinkPick   = null; // { type, id, name, yield_unit }
let posCandidates = null; // recipes + finished products, loaded on first link

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('sales-page-marker')) return;

  document.getElementById('posUploadBtn').addEventListener('click', openPosUpload);
  document.getElementById('posUploadClose').addEventListener('click', () => closeModal('posUploadModal'));
  document.getElementById('posSourceSelect').addEventListener('change', renderSourceHelp);
  document.getElementById('posReviewClose').addEventListener('click', () => closeModal('posReviewModal'));
  document.getElementById('posReviewCancel').addEventListener('click', () => closeModal('posReviewModal'));
  document.getElementById('posCommitBtn').addEventListener('click', commitPosImport);

  document.getElementById('posLinkClose').addEventListener('click', () => closeModal('posLinkModal'));
  document.getElementById('posLinkCancel').addEventListener('click', () => closeModal('posLinkModal'));
  document.getElementById('posLinkConfirm').addEventListener('click', confirmPosLink);
  document.getElementById('posLinkSearch').addEventListener('input', renderLinkResults);

  const dz = document.getElementById('posDropZone');
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('dragging'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragging'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('dragging');
    if (e.dataTransfer.files.length) handlePosFile(e.dataTransfer.files[0]);
  });
  document.getElementById('posFileInput').addEventListener('change', e => {
    if (e.target.files.length) handlePosFile(e.target.files[0]);
    e.target.value = '';   // so re-picking the same file still fires
  });

  renderSourceHelp();
  loadPosImports();
});

// ── List ───────────────────────────────────────────────────────
async function loadPosImports() {
  const body = document.getElementById('posImportsBody');
  try {
    const res = await apiGet('pos-imports');
    posImports = res.data || [];
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7" class="empty-row">Couldn't load imports — ${esc(err.message)}</td></tr>`;
    return;
  }

  if (!posImports.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty-row">
      No sales imported yet. Export a sales report from your till and upload it here.</td></tr>`;
    return;
  }

  body.innerHTML = posImports.map(r => {
    const period = r.period_start === r.period_end
      ? fmtDate(r.period_start)
      : `${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}`;
    const cov = r.net_total > 0 ? Math.round((r.mapped_net / r.net_total) * 100) : 0;
    return `<tr>
      <td>${esc(period)}</td>
      <td>${esc(posSourceLabel(r.source))}</td>
      <td>${r.line_count}</td>
      <td>${fmt(r.net_total)}</td>
      <td>${r.status === 'Closed' ? cov + '%' : '—'}</td>
      <td>${posStatusBadge(r)}</td>
      <td class="pos-row-actions">
        ${r.status === 'Action Required'
          ? `<button class="btn btn-sm btn-primary" onclick="openPosReview('${r.id}')">Review</button>
             <button class="btn btn-sm btn-danger" onclick="discardPosImport('${r.id}')">Discard</button>`
          : r.voided_at
            ? `<button class="btn btn-sm btn-secondary" onclick="restorePosImport('${r.id}')">Restore</button>`
            : `<button class="btn btn-sm btn-danger" onclick="voidPosImport('${r.id}')">Void</button>`}
      </td>
    </tr>`;
  }).join('');
}

function posSourceLabel(s) {
  return ({ square: 'Square', clover: 'Clover' })[s] || s || '—';
}

function posStatusBadge(r) {
  if (r.voided_at) return '<span class="badge badge-gray">Voided</span>';
  if (r.status === 'Action Required') return '<span class="badge badge-yellow">Needs mapping</span>';
  return '<span class="badge badge-green">Imported</span>';
}

// ── Upload ─────────────────────────────────────────────────────
function openPosUpload() {
  document.getElementById('posUploadError').innerHTML = '';
  openModal('posUploadModal');
}

function renderSourceHelp() {
  const src = document.getElementById('posSourceSelect').value;
  const help = {
    square: '<strong>Where to find this in Square:</strong> Dashboard → Reports → Item Sales → Export → <strong>Detail CSV</strong>. Export one month at a time.',
    clover: '<strong>Where to find this in Clover:</strong> Reporting → Item Sales → Export.',
  }[src] || '';
  document.getElementById('posSourceHelp').innerHTML = help;
}

function posUploadError(html) {
  document.getElementById('posUploadError').innerHTML =
    `<div class="pos-banner" style="margin-top:.9rem"><i class="fas fa-triangle-exclamation"></i><div>${html}</div></div>`;
}

async function handlePosFile(file) {
  document.getElementById('posUploadError').innerHTML = '';

  if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
    posUploadError('That needs to be a <strong>.csv</strong> file. Most tills call it "Export CSV".');
    return;
  }

  let text;
  try {
    text = await file.text();
  } catch (_) {
    posUploadError("Couldn't read that file.");
    return;
  }

  const parsed = window.posParse.parsePosCsv(text, file.name);
  if (!parsed.ok) {
    posUploadError(esc(parsed.message) + (parsed.help ? `<br><br>${esc(parsed.help)}` : ''));
    return;
  }

  // Content hash is the cheap duplicate guard — the identical file uploaded
  // twice. The real overlap guard (Jul 1–15 then Jul 1–31) is the unique index
  // on external_ref, enforced at commit.
  const hash = await sha256Hex(text);

  try {
    await savePosDraft(parsed, file, hash, false);
  } catch (err) {
    if (err.status === 409 && err.payload && err.payload.duplicate) {
      const d = err.payload;
      const ok = confirm(
        `You already uploaded "${d.file_name || 'this file'}" on ${fmtDate(d.imported_at)}.\n\n` +
        `Importing it again would count the same sales twice.\n\nImport it anyway?`
      );
      if (!ok) return;
      await savePosDraft(parsed, file, hash, true);
    } else {
      posUploadError(esc(err.message || 'Could not save that import.'));
    }
  }
}

async function savePosDraft(parsed, file, hash, force) {
  // The raw file goes to R2 as the audit copy — the same role as the invoice
  // photo. A failure here is not fatal: the numbers are already parsed, and an
  // import without its original attached beats no import at all.
  let fileKey = '';
  try {
    const up = await apiUploadFile(file);
    fileKey = up.key || '';
  } catch (_) { /* keep going — reported below only if the import itself fails */ }

  const res = await apiPost('pos-imports', {
    parsed, file_name: file.name, file_key: fileKey, content_hash: hash, force: !!force,
  });

  closeModal('posUploadModal');
  showToast(`Read ${parsed.lines.length} sales lines.`, 'success');
  await loadPosImports();
  openPosReview(res.import_id);
}

// SHA-256 of the file text, hex. SubtleCrypto is available on every browser
// this app already requires.
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Review ─────────────────────────────────────────────────────
async function openPosReview(id) {
  let row;
  try {
    row = await apiGet(`pos-imports/${id}`);
  } catch (err) {
    showToast(err.message || 'Could not open that import.', 'error');
    return;
  }
  if (!row.parsed) {
    showToast('That import has already been committed.', 'warning');
    return;
  }

  posDraft = { import_id: id, ...row.parsed, net_total: row.net_total };
  renderPosReview();
  openModal('posReviewModal');
}

function posItemState(it) {
  if (it.target_type === 'ignore') return 'ignored';
  if (it.target_type && it.target_id) return 'mapped';
  if (it.suggested_id) return 'suggested';
  return 'unmapped';
}

function renderPosReview() {
  const items = posDraft.items || [];
  const net   = Number(posDraft.totals?.net) || 0;

  const mappedNet = items.filter(i => posItemState(i) === 'mapped')
                         .reduce((s, i) => s + (Number(i.net_sales) || 0), 0);
  const coverage  = net > 0 ? Math.round((mappedNet / net) * 100) : 0;
  const covClass  = coverage >= 90 ? 'good' : coverage >= 60 ? 'part' : 'bad';

  const period = posDraft.period_start === posDraft.period_end
    ? fmtDate(posDraft.period_start)
    : `${fmtDate(posDraft.period_start)} – ${fmtDate(posDraft.period_end)}`;

  document.getElementById('posReviewSummary').innerHTML = `
    <div class="pos-summary">
      <div><span class="pos-sum-label">Period</span><span class="pos-sum-value">${esc(period)}</span></div>
      <div><span class="pos-sum-label">Sales lines</span><span class="pos-sum-value">${items.reduce((s,i)=>s+i.line_count,0)}</span></div>
      <div><span class="pos-sum-label">Net sales</span><span class="pos-sum-value">${fmt(net)}</span></div>
      <div class="pos-coverage ${covClass}">
        <span class="pos-sum-label">COGS coverage</span>
        <span class="pos-sum-value">${coverage}%</span>
      </div>
    </div>`;

  // The warning has to name the money, not just the count — "2 items" sounds
  // trivial, "$54.00, 24% of sales" does not.
  const unmapped = items.filter(i => ['unmapped', 'suggested'].includes(posItemState(i)));
  const unmappedNet = unmapped.reduce((s, i) => s + (Number(i.net_sales) || 0), 0);
  const pct = net > 0 ? Math.round((unmappedNet / net) * 100) : 0;

  document.getElementById('posReviewBanner').innerHTML = unmapped.length
    ? `<div class="pos-banner"><i class="fas fa-triangle-exclamation"></i><div>
         <strong>${unmapped.length} ${unmapped.length === 1 ? 'item isn\'t' : 'items aren\'t'}
         linked to a recipe</strong> (${fmt(unmappedNet)} — ${pct}% of sales).
         Their revenue will still be counted, but no ingredients come off stock,
         so your food cost will look lower than it really is.
       </div></div>`
    : '';

  document.getElementById('posMapBody').innerHTML = items.map((it, i) => {
    const state = posItemState(it);
    let target;
    if (state === 'mapped') {
      target = `<span class="pos-pill mapped"><i class="fas fa-check"></i> ${esc(it.target_name || '')}</span>
                <span class="pos-type-badge">${it.target_type === 'recipe' ? 'Recipe' : 'Finished product'}</span>
                ${it.match_source === 'remembered' ? '<span class="pos-type-badge">remembered</span>' : ''}
                ${it.match_source === 'auto' ? '<span class="pos-type-badge">matched by name</span>' : ''}`;
    } else if (state === 'suggested') {
      target = `<span class="pos-pill suggested"><i class="fas fa-lightbulb"></i> ${esc(it.suggested_name)}</span>
                <span class="pos-type-badge">${it.suggested_score}% match</span>`;
    } else if (state === 'ignored') {
      target = `<span class="pos-pill ignored"><i class="fas fa-ban"></i> Not tracked</span>`;
    } else {
      target = `<span class="pos-pill unmapped"><i class="fas fa-circle-exclamation"></i> Not linked</span>`;
    }

    const name = it.pos_item_name + (it.price_point ? ` · ${it.price_point}` : '');
    return `<tr>
      <td>${esc(name)}</td>
      <td>${it.qty}</td>
      <td>${fmt(it.net_sales)}</td>
      <td><div class="pos-map-target">${target}</div></td>
      <td class="pos-row-actions">
        ${state === 'suggested'
          ? `<button class="btn btn-sm btn-primary" onclick="acceptPosSuggestion(${i})">Use</button>` : ''}
        <button class="btn btn-sm btn-secondary" onclick="openPosLink(${i})">
          ${state === 'mapped' ? 'Change' : 'Link'}
        </button>
        ${state !== 'ignored'
          ? `<button class="btn btn-sm btn-secondary" onclick="ignorePosItem(${i})">Not tracked</button>`
          : `<button class="btn btn-sm btn-secondary" onclick="unignorePosItem(${i})">Track it</button>`}
      </td>
    </tr>`;
  }).join('');
}

function acceptPosSuggestion(i) {
  const it = posDraft.items[i];
  it.target_type  = it.suggested_type;
  it.target_id    = it.suggested_id;
  it.target_name  = it.suggested_name;
  it.qty_per_sale = 1;
  it.match_source = 'accepted';
  delete it.suggested_id; delete it.suggested_name; delete it.suggested_score;
  renderPosReview();
}

// 'ignore' exists so gift cards, bottled drinks and service charges stop
// lighting the warning. A warning that is permanently on is one nobody reads.
function ignorePosItem(i) {
  const it = posDraft.items[i];
  it.target_type = 'ignore';
  it.target_id = ''; it.target_name = '';
  renderPosReview();
}

function unignorePosItem(i) {
  const it = posDraft.items[i];
  it.target_type = ''; it.target_id = ''; it.target_name = '';
  renderPosReview();
}

// ── Link picker ────────────────────────────────────────────────
async function openPosLink(i) {
  posLinkTarget = i;
  posLinkPick   = null;
  const it = posDraft.items[i];

  document.getElementById('posLinkSubtitle').textContent =
    `"${it.pos_item_name}${it.price_point ? ' · ' + it.price_point : ''}" sold ${it.qty} times for ${fmt(it.net_sales)}.`;
  document.getElementById('posLinkSearch').value = '';
  document.getElementById('posLinkQtyWrap').classList.add('hidden');
  document.getElementById('posLinkAllSizes').checked = !it.price_point;
  document.getElementById('posLinkConfirm').disabled = true;

  if (!posCandidates) {
    document.getElementById('posLinkResults').innerHTML =
      '<div class="pos-link-empty"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
    openModal('posLinkModal');
    try {
      const [fps, recipes] = await Promise.all([
        apiGet('tables/finished_products?page=1&limit=500'),
        apiGet('tables/recipes?page=1&limit=500'),
      ]);
      posCandidates = [
        ...(fps.data || []).map(f => ({ type: 'finished_product', id: f.id, name: f.name })),
        ...(recipes.data || []).map(r => ({
          type: 'recipe', id: r.id, name: r.name,
          yield_unit: r.yield_unit || 'kg', production_mode: r.production_mode || 'on_demand',
        })),
      ];
    } catch (err) {
      document.getElementById('posLinkResults').innerHTML =
        `<div class="pos-link-empty">Couldn't load your recipes — ${esc(err.message)}</div>`;
      return;
    }
  } else {
    openModal('posLinkModal');
  }
  renderLinkResults();
}

function renderLinkResults() {
  const q = document.getElementById('posLinkSearch').value.trim().toLowerCase();
  const list = (posCandidates || [])
    .filter(c => !q || c.name.toLowerCase().includes(q))
    .slice(0, 40);

  const box = document.getElementById('posLinkResults');
  if (!list.length) {
    box.innerHTML = `<div class="pos-link-empty">${
      posCandidates && posCandidates.length
        ? 'Nothing matches that.'
        : "You haven't set up any recipes or finished products yet."
    }</div>`;
    return;
  }

  box.innerHTML = list.map(c => {
    const badge = c.type === 'recipe'
      ? `Recipe${c.production_mode === 'batched' ? ' · made ahead' : ''}`
      : 'Finished product';
    return `<div class="pos-link-item ${posLinkPick && posLinkPick.id === c.id ? 'active' : ''}"
                 onclick="pickPosLink('${c.type}','${esc(c.id)}')">
      <span>${esc(c.name)}</span>
      <span class="pos-type-badge">${badge}</span>
    </div>`;
  }).join('');
}

function pickPosLink(type, id) {
  posLinkPick = (posCandidates || []).find(c => c.type === type && c.id === id) || null;
  const isRecipe = posLinkPick && posLinkPick.type === 'recipe';
  document.getElementById('posLinkQtyWrap').classList.toggle('hidden', !isRecipe);
  if (isRecipe) {
    document.getElementById('posLinkQty').value  = 1;
    document.getElementById('posLinkUnit').value = posLinkPick.yield_unit || '';
  }
  document.getElementById('posLinkConfirm').disabled = !posLinkPick;
  renderLinkResults();
}

function confirmPosLink() {
  if (!posLinkPick || posLinkTarget === null) return;
  const it = posDraft.items[posLinkTarget];

  it.target_type  = posLinkPick.type;
  it.target_id    = posLinkPick.id;
  it.target_name  = posLinkPick.name;
  it.match_source = 'linked';
  it.all_sizes    = document.getElementById('posLinkAllSizes').checked;

  if (posLinkPick.type === 'recipe') {
    it.qty_per_sale = parseFloat(document.getElementById('posLinkQty').value) || 1;
    it.target_unit  = document.getElementById('posLinkUnit').value.trim() || posLinkPick.yield_unit || '';
  } else {
    it.qty_per_sale = 1;
    it.target_unit  = '';
  }

  delete it.suggested_id; delete it.suggested_name; delete it.suggested_score;
  closeModal('posLinkModal');
  renderPosReview();
}

// ── Commit ─────────────────────────────────────────────────────
async function commitPosImport() {
  const btn = document.getElementById('posCommitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing…';

  try {
    const res = await apiPost(`pos-imports/${posDraft.import_id}/commit`, {
      items: posDraft.items, deplete: true,
    });

    closeModal('posReviewModal');

    const bits = [`Imported ${res.lines_written} sales lines`];
    if (res.movements) bits.push(`${res.movements} stock movements`);
    if (res.skipped_duplicates) bits.push(`${res.skipped_duplicates} already imported, skipped`);
    showToast(bits.join(' · '), 'success');

    // Negative stock is the honest outcome of selling something that was never
    // recorded as bought, but it looks like a bug the first time. Name the bins
    // and say what usually causes it.
    if ((res.bins_negative || []).length) {
      alert(
        `These went below zero:\n\n  ${res.bins_negative.join('\n  ')}\n\n` +
        `That usually means a delivery wasn't recorded, or a recipe quantity is ` +
        `out by a decimal. The sales themselves imported fine.`
      );
    }
    if ((res.warnings || []).length) {
      alert(
        `${res.warnings.length} ${res.warnings.length === 1 ? 'ingredient' : 'ingredients'} ` +
        `couldn't be taken off stock, so your food cost will read low:\n\n  ` +
        res.warnings.map(w => w.message).join('\n  ')
      );
    }

    await loadPosImports();
  } catch (err) {
    showToast(err.message || 'Could not import those sales.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check"></i> Confirm &amp; Import';
  }
}

async function voidPosImport(id) {
  const reason = prompt('Void this import? Stock it took off will be put back.\n\nReason (optional):');
  if (reason === null) return;
  try {
    const res = await apiPost(`pos-imports/${id}/void`, { reason });
    showToast(`Voided · ${res.movements_reversed} stock movements reversed.`, 'success');
    await loadPosImports();
  } catch (err) {
    showToast(err.message || 'Could not void that import.', 'error');
  }
}

async function restorePosImport(id) {
  try {
    const res = await apiPost(`pos-imports/${id}/restore`, {});
    showToast(`Restored · ${res.movements_reapplied} stock movements re-applied.`, 'success');
    await loadPosImports();
  } catch (err) {
    showToast(err.message || 'Could not restore that import.', 'error');
  }
}

// ── Discard a draft ────────────────────────────────────────────
// Only drafts. A committed import has moved stock and fed the P&L, so it voids
// and reverses instead — never a plain delete.
async function discardPosImport(id) {
  if (!confirm('Discard this import? Nothing has been counted yet, so nothing will change.')) return;
  try {
    await apiDelete(`pos-imports/${id}`);
    showToast('Import discarded.', 'success');
    await loadPosImports();
  } catch (err) {
    showToast(err.message || 'Could not discard that import.', 'error');
  }
}
