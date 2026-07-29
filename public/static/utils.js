/* ===== utils.js ===== */

// API base — all calls go through /api/tables/:table
const API_BASE = '/api';

// ══════════════════════════════════════════════════════════════
// SESSION GUARD
// ══════════════════════════════════════════════════════════════
// Every /api/* route now requires a signed-in session. Rather than teach each
// of the six api* helpers (plus the ad-hoc fetch calls scattered through the
// page controllers) to handle a 401, wrap fetch once. Same reasoning as the
// server-side gate: a single chokepoint can't be forgotten.
//
// Only app pages load utils.js — login.html and admin.html do their own thing,
// so they are unaffected and there is no redirect loop.
(function installSessionGuard() {
  const original = window.fetch;
  let redirecting = false;

  window.fetch = async function (...args) {
    const response = await original.apply(this, args);

    // 402 = account paused for non-payment. Surfaced here for the same reason
    // as the 401 below: every write in the app goes through fetch, and without
    // this each controller would fail in its own way (or silently). The banner
    // says why; this says it again at the moment they try to save.
    if (response.status === 402) {
      // Throttled: a bulk action can fire many writes at once, and one clear
      // message is more useful than twenty stacked ones.
      const since = Date.now() - (window.__suspendToastAt || 0);
      if (typeof showToast === 'function' && since > 4000) {
        window.__suspendToastAt = Date.now();
        showToast('Account paused — payment overdue. Changes cannot be saved.', 'error');
      }
    }

    if (response.status === 401 && !redirecting) {
      let url = '';
      try {
        const input = args[0];
        url = typeof input === 'string' ? input : (input && input.url) || '';
      } catch (_) {}

      // Only bounce on our own API. A 401 from somewhere else isn't a session
      // problem and shouldn't throw the user out of the app.
      const isOurApi = url.startsWith('/api/') || url.includes(location.origin + '/api/');
      if (isOurApi && !location.pathname.startsWith('/login')) {
        redirecting = true;
        // Remember where they were so login can send them back.
        const next = encodeURIComponent(location.pathname + location.search);
        location.href = `/login?next=${next}`;
      }
    }
    return response;
  };
})();

// ─── Plan gating (client side) ────────────────────────────────
// Which Pro feature each page belongs to. Keep in step with featureForPath()
// and PRO_ONLY_TABLES in src/index.ts.
//
// This is presentation only. The pages themselves are static files served by
// Cloudflare Pages without touching the worker, so this cannot be a security
// boundary — the server refuses the Pro *actions* behind them. What this does is
// stop an Essential customer being shown a screen that would only fill with
// permission errors.
const PLAN_GATED_PAGES = {
  '/inventory':      { feature: 'inventory_tools', name: 'Inventory' },
  '/stock-take':     { feature: 'stock_takes',     name: 'Stock Takes' },
  '/storage-layout': { feature: 'storage_layout',  name: 'Storage Layout' },
  '/staff':          { feature: 'staff',           name: 'Staff' },
  '/certifications': { feature: 'staff',           name: 'Staff Certifications' },
};

// Cloudflare Pages strips ".html" and 308-redirects, but local dev keeps it, so
// links and locations have to be compared with the suffix removed.
function _planPagePath(href) {
  try {
    const p = new URL(href, location.origin).pathname;
    return p.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  } catch (_) { return ''; }
}

// Hide nav links the plan doesn't include, and — if this IS a gated page,
// reached by URL or bookmark — replace its content with an upgrade note.
function applyPlanGating(me) {
  const features = new Set(me.features || []);

  document.querySelectorAll('.nav-links a[href]').forEach(a => {
    const gate = PLAN_GATED_PAGES[_planPagePath(a.getAttribute('href'))];
    if (gate && !features.has(gate.feature)) a.style.display = 'none';
  });

  const here = PLAN_GATED_PAGES[_planPagePath(location.pathname)];
  if (!here || features.has(here.feature)) return;

  const container = document.querySelector('.container');
  if (!container) return;
  container.innerHTML = `
    <div style="max-width:520px;margin:4rem auto;text-align:center;
                background:#fff;border:1px solid var(--border,#e2e8f0);
                border-radius:12px;padding:2.5rem 2rem">
      <i class="fas fa-lock" style="font-size:1.75rem;color:var(--primary,#4f46e5)"></i>
      <h2 style="margin:.9rem 0 .5rem;font-size:1.25rem">${esc(here.name)} is part of Pro</h2>
      <p style="color:var(--text-muted,#64748b);font-size:.92rem;line-height:1.6;margin:0 0 1.5rem">
        Your plan covers everything that runs off your invoices — costs, price
        movements and recipes. ${esc(here.name)} is part of Pro, which adds stock
        counting and variance.
      </p>
      <a href="/home.html" class="btn btn-primary"
         style="display:inline-block;text-decoration:none">Back to Price Movers</a>
      <p style="color:var(--text-muted,#64748b);font-size:.8rem;margin:1.25rem 0 0">
        Want it switched on? Just get in touch.
      </p>
    </div>`;
}

// Small "signed in as … / Sign out" chip, injected into the nav of whichever
// app page is loaded. Done here rather than editing 13 HTML files, and it
// gives every page a way to sign out.
async function renderSessionChip() {
  const nav = document.querySelector('.navbar');
  if (!nav || document.getElementById('sessionChip')) return;

  let me = null, viewingAs = null;
  try {
    const r = await fetch('/api/auth/me');
    if (r.ok) { const d = await r.json(); me = d.user; viewingAs = d.viewing_as; }
  } catch (_) { return; }
  if (!me) return;

  // Viewing a customer's data: make that impossible to miss. Without this an
  // operator could edit a customer's numbers believing they were their own.
  if (viewingAs) renderViewingAsBar(viewingAs);

  // Paused for non-payment: the app still reads, but every save will be
  // refused. Say so up front rather than letting them fill in a stock take and
  // lose it at the last step.
  if (me.suspended) renderSuspendedBar(me.suspend_reason);

  // Before the chip, so a gated page swaps its content in the same frame rather
  // than flashing the real screen first.
  applyPlanGating(me);

  const chip = document.createElement('div');
  chip.id = 'sessionChip';
  chip.style.cssText =
    'margin-left:auto;display:flex;align-items:center;gap:.6rem;' +
    'font-size:.78rem;color:rgba(255,255,255,.92);white-space:nowrap';
  chip.innerHTML = `
    <span title="${esc(me.email)}">
      <i class="fas fa-user-circle"></i>
      ${esc(me.org_name || (me.is_super_admin ? 'Admin' : me.email))}
    </span>
    ${me.is_super_admin ? '<a href="/admin" style="color:#fff;opacity:.85;text-decoration:none" title="Admin"><i class="fas fa-gear"></i></a>' : ''}
    <a href="#" id="navChangePw" style="color:#fff;opacity:.85;text-decoration:none" title="Change password">
      <i class="fas fa-key"></i>
    </a>
    <a href="#" id="navSignOut" style="color:#fff;opacity:.85;text-decoration:none" title="Sign out">
      <i class="fas fa-arrow-right-from-bracket"></i>
    </a>`;
  nav.appendChild(chip);

  document.getElementById('navChangePw').addEventListener('click', (e) => {
    e.preventDefault();
    openChangePasswordModal();
  });

  document.getElementById('navSignOut').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  });
}

// ══════════════════════════════════════════════════════════════
// CHANGE PASSWORD
// ══════════════════════════════════════════════════════════════
// The markup is injected rather than copied into all 13 app pages — same
// reasoning as the session chip above. Every page that loads utils.js gets it.
//
// Changing the password does NOT sign you out: the session token is
// <userId>.<expiry>.<hmac> and doesn't depend on the password, so the current
// session stays valid. Worth knowing — it also means changing the password does
// not boot anyone else who is already signed in as this user. Signing them out
// is what rotating SESSION_SECRET is for.
const MIN_PASSWORD_LEN = 8;

function ensureChangePasswordModal() {
  if (document.getElementById('changePwModal')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="modal-overlay hidden" id="changePwModal">
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <h3><i class="fas fa-key"></i> Change password</h3>
          <button class="modal-close" onclick="closeModal('changePwModal')"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:.25rem">Current password</label>
          <input type="password" id="cpCurrent" autocomplete="current-password" style="width:100%;margin-bottom:.75rem">

          <label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:.25rem">New password</label>
          <input type="password" id="cpNew" autocomplete="new-password" style="width:100%;margin-bottom:.25rem">
          <div style="font-size:.76rem;color:var(--text-muted);margin-bottom:.75rem">
            At least ${MIN_PASSWORD_LEN} characters.
          </div>

          <label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:.25rem">Confirm new password</label>
          <input type="password" id="cpConfirm" autocomplete="new-password" style="width:100%"
                 onkeydown="if(event.key==='Enter') submitChangePassword()">

          <div id="cpError" style="color:#dc2626;font-size:.82rem;margin-top:.6rem;display:none"></div>
          <div id="cpOk" style="color:#15803d;font-size:.82rem;margin-top:.6rem;display:none">
            <i class="fas fa-check"></i> Password changed. You are still signed in.
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal('changePwModal')">Cancel</button>
          <button class="btn btn-primary" id="cpSave" onclick="submitChangePassword()">Save</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap.firstElementChild);
}

function openChangePasswordModal() {
  ensureChangePasswordModal();
  ['cpCurrent', 'cpNew', 'cpConfirm'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('cpError').style.display = 'none';
  document.getElementById('cpOk').style.display = 'none';
  openModal('changePwModal');
  document.getElementById('cpCurrent').focus();
}

async function submitChangePassword() {
  const errEl = document.getElementById('cpError');
  const okEl  = document.getElementById('cpOk');
  const btn   = document.getElementById('cpSave');
  const current = document.getElementById('cpCurrent').value;
  const next    = document.getElementById('cpNew').value;
  const confirm = document.getElementById('cpConfirm').value;

  const fail = (m) => { okEl.style.display = 'none'; errEl.textContent = m; errEl.style.display = ''; };
  errEl.style.display = 'none';

  if (!current)                     return fail('Enter your current password.');
  if (next.length < MIN_PASSWORD_LEN) return fail(`New password must be at least ${MIN_PASSWORD_LEN} characters.`);
  if (next !== confirm)             return fail('The two new passwords do not match.');
  if (next === current)             return fail('The new password is the same as the current one.');

  btn.disabled = true;
  const prev = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    const r = await fetch(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: current, new_password: next }),
    });
    const data = await r.json().catch(() => ({}));
    // 403 means the current password was wrong. Deliberately not a 401 — that
    // would trip the session guard above and throw the user out to /login.
    if (!r.ok) return fail(data.error || 'Could not change the password.');

    okEl.style.display = '';
    ['cpCurrent', 'cpNew', 'cpConfirm'].forEach(id => { document.getElementById(id).value = ''; });
  } catch (_) {
    fail('Could not reach the server. Check your connection and try again.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = prev;
  }
}

// Red bar pinned to the top while the account is paused for non-payment.
// Deliberately not dismissible: it is the only explanation the customer gets
// for why saving stopped working, and the 402 responses are silent.
function renderSuspendedBar(reason) {
  if (document.getElementById('suspendedBar')) return;
  const bar = document.createElement('div');
  bar.id = 'suspendedBar';
  bar.style.cssText =
    'position:sticky;top:0;z-index:201;display:flex;align-items:center;gap:.6rem;' +
    'padding:.55rem 1rem;background:#fee2e2;border-bottom:1px solid #fca5a5;' +
    'color:#991b1b;font-size:.85rem;font-weight:600';
  bar.innerHTML = `
    <i class="fas fa-circle-exclamation"></i>
    <span>
      Your account is paused because payment is overdue — you can still view
      everything, but changes can't be saved.
      ${reason ? `<span style="font-weight:500">(${esc(reason)})</span>` : ''}
      Contact us to restore access.
    </span>`;
  document.body.insertBefore(bar, document.body.firstChild);
}

// Amber bar pinned to the top while a super-admin is viewing a customer's data.
function renderViewingAsBar(org) {
  if (document.getElementById('viewingAsBar')) return;
  const bar = document.createElement('div');
  bar.id = 'viewingAsBar';
  bar.style.cssText =
    'position:sticky;top:0;z-index:200;display:flex;align-items:center;gap:.6rem;' +
    'padding:.5rem 1rem;background:#fef3c7;border-bottom:1px solid #fcd34d;' +
    'color:#92400e;font-size:.85rem;font-weight:600';
  bar.innerHTML = `
    <i class="fas fa-eye"></i>
    <span>Viewing <strong>${esc(org.name)}</strong> — you are signed in as yourself, not as them.</span>
    <button id="exitViewAs" style="margin-left:auto;font-family:inherit;font-size:.8rem;font-weight:600;
            cursor:pointer;background:#92400e;color:#fff;border:none;border-radius:6px;padding:.3rem .7rem">
      Exit
    </button>`;
  document.body.insertBefore(bar, document.body.firstChild);

  document.getElementById('exitViewAs').addEventListener('click', async () => {
    await fetch('/api/admin/view-as', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ org_id: null }),
    });
    location.href = '/admin';
  });
}

document.addEventListener('DOMContentLoaded', renderSessionChip);

// API helpers
async function apiGet(url) {
  const r = await fetch(`${API_BASE}/${url}`);
  if (!r.ok) throw new Error(`GET ${url} failed: ${r.status}`);
  return r.json();
}
async function apiPost(url, data) {
  const r = await fetch(`${API_BASE}/${url}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  if (!r.ok) {
    let msg = `POST ${url} failed: ${r.status}`;
    try { const j = await r.json(); if (j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}
async function apiPut(url, data) {
  const r = await fetch(`${API_BASE}/${url}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  if (!r.ok) throw new Error(`PUT ${url} failed: ${r.status}`);
  return r.json();
}
async function apiPatch(url, data) {
  const r = await fetch(`${API_BASE}/${url}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  if (!r.ok) throw new Error(`PATCH ${url} failed: ${r.status}`);
  return r.json();
}
async function apiDelete(url) {
  const r = await fetch(`${API_BASE}/${url}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`DELETE ${url} failed: ${r.status}`);
}

// Upload a file to R2, returns { key, url, name }
async function apiUploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(`${API_BASE}/upload`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error('File upload failed: ' + r.status);
  return r.json();
}

// Toast
let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = '';
  const icon = document.createElement('i');
  if (type === 'success') { icon.className = 'fas fa-check-circle'; el.className = 'toast toast-success'; }
  else if (type === 'error') { icon.className = 'fas fa-exclamation-circle'; el.className = 'toast toast-error'; }
  else if (type === 'warning') { icon.className = 'fas fa-exclamation-triangle'; el.className = 'toast toast-warning'; }
  else { icon.className = 'fas fa-info-circle'; el.className = 'toast'; }
  el.appendChild(icon);
  el.appendChild(document.createTextNode(' ' + msg));
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// Days remaining until a date string
function daysLeft(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.floor((d - today) / 86400000);
}

// Badge for days left
function daysBadge(days) {
  if (days === null) return '<span class="badge badge-gray"><i class="fas fa-minus"></i> N/A</span>';
  if (days < 0)  return `<span class="badge badge-red"><i class="fas fa-skull-crossbones"></i> Expired ${Math.abs(days)}d ago</span>`;
  if (days <= 7) return `<span class="badge badge-red"><i class="fas fa-fire"></i> ${days}d left</span>`;
  if (days <= 30) return `<span class="badge badge-yellow"><i class="fas fa-clock"></i> ${days}d left</span>`;
  return `<span class="badge badge-green"><i class="fas fa-check"></i> ${days}d left</span>`;
}

// Format a YYYY-MM-DD string as YYYY/MM/DD (app-wide standard date format)
function fmtDate(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : iso;
}

// Format an ISO datetime string as YYYY/MM/DD, HH:mm
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}, ${hh}:${min}`;
}

// Currency format
function fmt(n) {
  const num = parseFloat(n);
  return isNaN(num) ? '$0.00' : '$' + num.toFixed(2);
}

// Escape HTML to prevent XSS.
//
// NOTE: this does not escape the apostrophe, so esc() output is safe inside a
// DOUBLE-quoted attribute and as text, but NOT inside a single-quoted JS string
// in an inline handler:
//
//   BAD:  onclick="del('${esc(name)}')"                    <- "Baker's" ends the
//                                                             string early:
//                                                             SyntaxError, dead button
//   GOOD: onclick="del(this.dataset.name)" data-name="${esc(name)}"
//
// The data-attribute form is never parsed as code, so any name is safe. Escaping
// the quote instead does NOT work: a previous attempt chained
// .replace(/'/g,"\\'") onto esc(), which is a no-op here (nothing escapes the
// apostrophe for it to find) and is a no-op the other way too, since a &#39; is
// decoded back into ' by the HTML parser before the JS is compiled.
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Modal helpers
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// If the nav has more tabs than fit, keep the current (active) tab — and its
// neighbours — in view by scrolling the nav-links strip to it on load.
document.addEventListener('DOMContentLoaded', () => {
  const active = document.querySelector('.nav-links a.active');
  if (active && active.scrollIntoView) {
    try { active.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (_) {}
  }
});

// Slugify a string to CSS-safe class name
function slugify(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Product categories ────────────────────────────────────────────
// Built-in taxonomy, grouped into food (COGS) / beverage / operating
// supplies so the spending-breakdown report splits food cost the way a
// professional kitchen tracks it, instead of one giant "Ingredients" bucket.
// Category is stored as free-text on each product, so users can also add
// their own (see populateCategoryDropdown's "+ New category…" option).
// This constant is the single source of truth for the built-in list; a
// follow-up will promote categories to a DB-managed table (like `units`).
const DEFAULT_CATEGORIES = [
  // Food (COGS)
  'Produce', 'Meat & Poultry', 'Seafood', 'Dairy & Eggs',
  'Dry Goods & Pantry', 'Bakery', 'Frozen',
  'Oils, Sauces & Condiments', 'Spices & Seasonings',
  // Beverage
  'Alcohol', 'Non-Alcoholic Beverages',
  // Operating supplies
  'Packaging', 'Disposables', 'Cleaning & Sanitation',
  'Linen & Uniforms', 'Smallwares & Equipment', 'Office & Admin',
  // Fallback
  'Other',
];

// Cost-group type per built-in category. Source of truth is the DB
// `categories.type` column (migration 0020); this mirrors it for the frontend
// fallback when the DB list is unavailable. 4th taxonomy sync point — keep
// aligned with DEFAULT_CATEGORIES, the .cat-<slug> CSS, and inferCategory.
const DEFAULT_CATEGORY_TYPES = {
  'Produce': 'food', 'Meat & Poultry': 'food', 'Seafood': 'food', 'Dairy & Eggs': 'food',
  'Dry Goods & Pantry': 'food', 'Bakery': 'food', 'Frozen': 'food',
  'Oils, Sauces & Condiments': 'food', 'Spices & Seasonings': 'food',
  'Alcohol': 'beverage', 'Non-Alcoholic Beverages': 'beverage',
  'Packaging': 'supplies', 'Disposables': 'supplies', 'Cleaning & Sanitation': 'supplies',
  'Linen & Uniforms': 'supplies', 'Smallwares & Equipment': 'supplies', 'Office & Admin': 'supplies',
  'Other': 'food',
};

// Sentinel option values for the dropdown's action rows.
const NEW_CATEGORY_SENTINEL    = '__new_category__';
const MANAGE_CATEGORY_SENTINEL = '__manage_categories__';

// Dedupe a set of name lists case-insensitively, preserving first-seen order.
function dedupeNames(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const c of (list || [])) {
      const v = (c || '').trim();
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

// Merge the built-in list with any extra categories (e.g. those already saved
// on products). Built-in order first, extras appended A→Z. Used for stat chips
// and as a fallback when the DB category list isn't available.
function mergeCategories(extra = []) {
  const seen = new Set(DEFAULT_CATEGORIES.map(c => c.toLowerCase()));
  const extras = [];
  for (const c of extra) {
    const v = (c || '').trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    extras.push(v);
  }
  extras.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return [...DEFAULT_CATEGORIES, ...extras];
}

// Populate a category <select> from an explicit list of names, plus the
// "+ New category…" and "+ Manage categories" action rows.
//   select        – the <select> element
//   selectedValue – value to preselect (falls back to the select's current value)
//   categories    – names to list (from the DB categories table). Falls back to
//                   the built-in taxonomy if empty.
function populateCategoryDropdown(select, selectedValue, categories) {
  if (!select) return;
  const prev = selectedValue !== undefined ? selectedValue : select.value;
  const names = (categories && categories.length) ? categories : DEFAULT_CATEGORIES;
  select.innerHTML =
    '<option value="">— Select category —</option>' +
    names.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('') +
    `<option value="${NEW_CATEGORY_SENTINEL}" style="color:var(--primary);font-style:italic">+ New category…</option>` +
    `<option value="${MANAGE_CATEGORY_SENTINEL}" style="color:var(--primary);font-style:italic">⚙ Manage categories</option>`;
  // Case-insensitive reselect so a stored value like "produce" still matches.
  if (prev) {
    const lower = String(prev).toLowerCase();
    const opt = Array.from(select.options).find(o => o.value.toLowerCase() === lower);
    if (opt) {
      select.value = opt.value;
    } else {
      // A value not in the list (custom/legacy): inject it so it stays selected.
      const injected = document.createElement('option');
      injected.value = prev; injected.textContent = prev;
      select.insertBefore(injected, select.options[select.options.length - 2]);
      select.value = prev;
    }
  }
  select.dataset.prevCat = select.value;
}

// Wire a category <select> so the action rows work:
//   "+ New category…"     → prompt, persist to the DB categories table, select it
//   "⚙ Manage categories" → open the Manage Categories modal
// Falls back to the previous value on cancel/blank/duplicate. Call once.
function attachNewCategoryHandler(select) {
  if (!select || select.dataset.newCatWired) return;
  select.dataset.newCatWired = '1';
  select.dataset.prevCat = select.value;
  select.addEventListener('change', async () => {
    const v = select.value;

    if (v === MANAGE_CATEGORY_SENTINEL) {
      select.value = select.dataset.prevCat || '';
      openManageCategoriesModal();
      return;
    }

    if (v !== NEW_CATEGORY_SENTINEL) {
      select.dataset.prevCat = v;
      return;
    }

    const name = (window.prompt('New category name:') || '').trim();
    if (!name) { select.value = select.dataset.prevCat || ''; return; }

    // Already listed? Just select it (case-insensitive).
    const existing = Array.from(select.options).find(
      o => o.value.toLowerCase() === name.toLowerCase() &&
           o.value !== NEW_CATEGORY_SENTINEL && o.value !== MANAGE_CATEGORY_SENTINEL
    );
    if (existing) {
      select.value = existing.value;
      select.dataset.prevCat = select.value;
      return;
    }

    // Persist to the master list, then refresh every category dropdown.
    try {
      await apiPost('tables/categories', { name, sort_order: 100 });
      await _refreshAllCategoriesAndDropdowns();
    } catch (e) {
      // Non-fatal (e.g. UNIQUE race) — still show it locally for this save.
    }
    const opt = Array.from(select.options).find(o => o.value.toLowerCase() === name.toLowerCase());
    if (opt) {
      select.value = opt.value;
    } else {
      const injected = document.createElement('option');
      injected.value = name; injected.textContent = name;
      select.insertBefore(injected, select.options[select.options.length - 2]);
      select.value = name;
    }
    select.dataset.prevCat = select.value;
  });
}

// ── Manage Units ──────────────────────────────────────────────────
const _unitRefreshCallbacks = [];
let _manageUnitsCache = [];

function registerUnitRefreshCallback(fn) {
  _unitRefreshCallbacks.push(fn);
}

async function _refreshAllUnitsAndDropdowns() {
  for (const fn of _unitRefreshCallbacks) {
    try { await fn(); } catch (e) { console.error('Unit refresh error', e); }
  }
}

async function openManageUnitsModal() {
  if (!document.getElementById('manageUnitsModal')) return;
  await renderManageUnitsList();
  openModal('manageUnitsModal');
}

async function renderManageUnitsList() {
  const container = document.getElementById('manageUnitsList');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
  try {
    const data = await apiGet('tables/units?page=1&limit=100');
    _manageUnitsCache = (data.data || []).sort((a, b) => a.sort_order - b.sort_order);
    // Clarify the ounce ambiguity: 'oz' is treated as weight everywhere; fluid
    // ounces are the separate 'fl oz' unit. They never convert into each other.
    const hint = `<div style="font-size:.76rem;color:var(--text-muted);background:#f8fafc;border:1px solid var(--border);border-radius:6px;padding:.45rem .6rem;margin-bottom:.6rem;line-height:1.5">
      <i class="fas fa-circle-info" style="color:#6366f1"></i>
      <strong>oz</strong> means weight (28&nbsp;g). For fluid ounces use <strong>fl&nbsp;oz</strong> (30&nbsp;ml) — the two never convert into each other.
    </div>`;
    if (!_manageUnitsCache.length) {
      container.innerHTML = hint + '<div style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0">No units defined yet.</div>';
      return;
    }
    container.innerHTML = hint + _manageUnitsCache.map(u => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:.45rem .65rem;border:1px solid var(--border);border-radius:6px;margin-bottom:.35rem;background:#fafbff">
        <span style="font-weight:500;font-size:.92rem">${esc(u.name)}</span>
        <button class="btn btn-danger btn-icon" onclick="deleteUnit(${u.id}, this.dataset.name)" data-name="${esc(u.name)}" title="Delete unit" style="padding:.3rem .55rem;font-size:.78rem">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<div style="color:#dc2626;font-size:.85rem">Failed to load units.</div>';
  }
}

async function addUnit() {
  const input = document.getElementById('newUnitName');
  const errEl = document.getElementById('manageUnitsError');
  const raw = (input?.value || '').trim();

  errEl.style.display = 'none';

  if (!raw) {
    errEl.textContent = 'Please enter a unit name.';
    errEl.style.display = '';
    return;
  }

  // Normalize: lowercase, except 'l' / 'L' (litre) stays uppercase
  const name = raw.toLowerCase() === 'l' ? 'L' : raw.toLowerCase();

  if (_manageUnitsCache.some(u => u.name.toLowerCase() === name.toLowerCase())) {
    errEl.textContent = `Unit "${name}" already exists.`;
    errEl.style.display = '';
    return;
  }

  try {
    await apiPost('tables/units', { name, sort_order: 0 });
    input.value = '';
    await renderManageUnitsList();
    await _refreshAllUnitsAndDropdowns();
  } catch (e) {
    errEl.textContent = e.message || 'Failed to add unit.';
    errEl.style.display = '';
  }
}

async function deleteUnit(id, name) {
  const res = await fetch(`/api/units/${id}`, { method: 'DELETE' });

  if (res.status === 204) {
    await renderManageUnitsList();
    await _refreshAllUnitsAndDropdowns();
    return;
  }

  let data = {};
  try { data = await res.json(); } catch (_) {}

  if (data.warning) {
    const confirmed = confirm(
      `This unit is used by ${data.count} product ${data.count === 1 ? 'entry' : 'entries'}. Are you sure you want to delete it?`
    );
    if (!confirmed) return;
    const res2 = await fetch(`/api/units/${id}?force=true`, { method: 'DELETE' });
    if (res2.status === 204) {
      await renderManageUnitsList();
      await _refreshAllUnitsAndDropdowns();
    } else {
      showToast('Failed to delete unit.', 'error');
    }
    return;
  }

  showToast(data.error || 'Failed to delete unit.', 'error');
}

window.openManageUnitsModal = openManageUnitsModal;
window.addUnit  = addUnit;
window.deleteUnit = deleteUnit;

// ── Manage Categories ─────────────────────────────────────────────
// Mirrors Manage Units: a DB-backed master list (categories table) edited
// through a modal, with callbacks so every open category dropdown refreshes.
const _categoryRefreshCallbacks = [];
let _manageCategoriesCache = [];

function registerCategoryRefreshCallback(fn) {
  _categoryRefreshCallbacks.push(fn);
}

async function _refreshAllCategoriesAndDropdowns() {
  for (const fn of _categoryRefreshCallbacks) {
    try { await fn(); } catch (e) { console.error('Category refresh error', e); }
  }
}

// Fetch the category master list (sorted), for callers that need the names.
async function fetchCategoryNames() {
  const data = await apiGet('tables/categories?page=1&limit=200');
  return (data.data || [])
    .slice()
    .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name))
    .map(c => c.name);
}

async function openManageCategoriesModal() {
  if (!document.getElementById('manageCategoriesModal')) return;
  await renderManageCategoriesList();
  openModal('manageCategoriesModal');
}

async function renderManageCategoriesList() {
  const container = document.getElementById('manageCategoriesList');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
  try {
    const data = await apiGet('tables/categories?page=1&limit=200');
    _manageCategoriesCache = (data.data || [])
      .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
    if (!_manageCategoriesCache.length) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0">No categories defined yet.</div>';
      return;
    }
    const typeOpts = (sel) => ['food', 'beverage', 'supplies']
      .map(t => `<option value="${t}"${(sel || 'food') === t ? ' selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`)
      .join('');
    container.innerHTML = _manageCategoriesCache.map(c => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.45rem .65rem;border:1px solid var(--border);border-radius:6px;margin-bottom:.35rem;background:#fafbff">
        <span style="font-weight:500;font-size:.92rem;flex:1">${esc(c.name)}</span>
        <select onchange="editCategoryType(${c.id}, this.value)" title="Category type" style="font-size:.8rem;padding:.2rem .4rem">
          ${typeOpts(c.type)}
        </select>
        <button class="btn btn-danger btn-icon" onclick="deleteCategory(${c.id}, this.dataset.name)" data-name="${esc(c.name)}" title="Delete category" style="padding:.3rem .55rem;font-size:.78rem">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<div style="color:#dc2626;font-size:.85rem">Failed to load categories.</div>';
  }
}

async function addCategory() {
  const input = document.getElementById('newCategoryName');
  const errEl = document.getElementById('manageCategoriesError');
  const name  = (input?.value || '').trim();

  errEl.style.display = 'none';

  if (!name) {
    errEl.textContent = 'Please enter a category name.';
    errEl.style.display = '';
    return;
  }
  if (_manageCategoriesCache.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    errEl.textContent = `Category "${name}" already exists.`;
    errEl.style.display = '';
    return;
  }

  const type = document.getElementById('newCategoryType')?.value || 'food';

  try {
    await apiPost('tables/categories', { name, type, sort_order: 100 });
    input.value = '';
    await renderManageCategoriesList();
    await _refreshAllCategoriesAndDropdowns();
  } catch (e) {
    errEl.textContent = e.message || 'Failed to add category.';
    errEl.style.display = '';
  }
}

// Change a category's cost-group type (Food / Beverage / Supplies).
async function editCategoryType(id, type) {
  try {
    await apiPatch(`tables/categories/${id}`, { type });
    const row = _manageCategoriesCache.find(c => c.id === id);
    if (row) row.type = type;
    await _refreshAllCategoriesAndDropdowns();
  } catch (e) {
    showToast('Failed to update category type.', 'error');
  }
}

async function deleteCategory(id, name) {
  const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });

  if (res.status === 204) {
    await renderManageCategoriesList();
    await _refreshAllCategoriesAndDropdowns();
    return;
  }

  let data = {};
  try { data = await res.json(); } catch (_) {}

  if (data.warning) {
    const confirmed = confirm(
      `"${name}" is assigned to ${data.count} ${data.count === 1 ? 'product' : 'products'}. ` +
      `Deleting it only removes it from the picker — those products keep the label. Delete anyway?`
    );
    if (!confirmed) return;
    const res2 = await fetch(`/api/categories/${id}?force=true`, { method: 'DELETE' });
    if (res2.status === 204) {
      await renderManageCategoriesList();
      await _refreshAllCategoriesAndDropdowns();
    } else {
      showToast('Failed to delete category.', 'error');
    }
    return;
  }

  showToast(data.error || 'Failed to delete category.', 'error');
}

window.openManageCategoriesModal = openManageCategoriesModal;
window.addCategory = addCategory;
window.editCategoryType = editCategoryType;
window.deleteCategory = deleteCategory;

/* ============================================================
 * Stock movement reasons (shared)
 * ============================================================
 * ONE taxonomy for every place stock moves by hand — the Adjust Stock modal
 * (inventory page) and stock-take variances. `code` is written to
 * `stock_log.reason_code` (migration 0029) and `stock_take_items.reason_code`
 * (0031) so waste is queryable; `label` is written to the free-text `reason`
 * column for readability and back-compat with rows created before the codes
 * existed.
 *
 * `types` says which direction a reason makes sense in:
 *   add    — stock going up   (an adjustment that adds, or a POSITIVE variance)
 *   remove — stock going down (an adjustment that removes, or a NEGATIVE one)
 *   set    — correcting to a counted figure
 *
 * A stock-take variance reuses the same directions: counting MORE than expected
 * is an 'add', counting less is a 'remove'. That is why one list serves both.
 *
 * Adding a code here is all that is needed — no backend change, because the
 * client sends the code and its label together.
 */
const STOCK_REASONS = [
  { code: 'received',     label: 'Received / delivery',   types: ['add'] },
  { code: 'production',   label: 'Production / batch',    types: ['add'] },
  { code: 'transfer_in',  label: 'Transfer in',           types: ['add'] },
  { code: 'usage',        label: 'Kitchen usage',         types: ['remove'] },
  { code: 'spillage',     label: 'Spillage / waste',      types: ['remove'] },
  { code: 'breakage',     label: 'Breakage',              types: ['remove'] },
  { code: 'staff_meal',   label: 'Staff meal',            types: ['remove'] },
  { code: 'sample',       label: 'Sample / comp',         types: ['remove'] },
  { code: 'theft',        label: 'Theft / loss',          types: ['remove'] },
  { code: 'transfer_out', label: 'Transfer out',          types: ['remove'] },
  { code: 'correction',   label: 'Stock correction',      types: ['add', 'remove', 'set'] },
  { code: 'other',        label: 'Other',                 types: ['add', 'remove'] },
];

function stockReasonsFor(type) {
  return STOCK_REASONS.filter(r => r.types.includes(type));
}

function stockReasonLabel(code) {
  return (STOCK_REASONS.find(r => r.code === code) || {}).label || '';
}

// Values written before the codes existed are plain labels ("Kitchen usage").
// Map those onto their code so old in-progress takes keep their selection.
function stockReasonCode(stored) {
  const v = (stored || '').trim();
  if (!v) return '';
  if (STOCK_REASONS.some(r => r.code === v)) return v;
  const byLabel = STOCK_REASONS.find(r => r.label.toLowerCase() === v.toLowerCase());
  return byLabel ? byLabel.code : v;   // unknown legacy text is preserved as-is
}

/* ============================================================
 * Multi-level pack units (shared)
 * ============================================================
 * A product can be counted several ways that all reconcile to ONE on-hand
 * figure in a base weight unit — e.g. a case of pepperoni = 25 lb = 5 bags
 * × 5 lb. See migration 0026 for the data model.
 *
 * These helpers are shared by the stock take (public/static/stock-take.js) and
 * the Adjust Stock modal (public/static/inventory.js) so both pages offer the
 * same box-per-level entry instead of forcing base-unit mental arithmetic.
 * The caller owns the box state; everything here is pure.
 *
 * Box state shape: { top: string, mid: string, base: string }
 *
 * Markup uses the `.st-pack*` / `.st-input` classes from stock-take.css, which
 * both inventory.html and stock-take.html already load.
 */

// Base is always a weight, so the summed total can be converted into whatever
// unit the inventory row itself is stored in.
const _PK_WT_FACTOR = { lb: 0.45359237, lbs: 0.45359237, kg: 1, g: 0.001, oz: 0.0283495231 };

function pkWtFactor(u) { return _PK_WT_FACTOR[String(u || '').trim().toLowerCase()]; }
function pkSameUnit(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
function pkRound6(n) { return Math.round(n * 1e6) / 1e6; }

function pkFmtQty(n) {
  const num = parseFloat(n);
  if (isNaN(num)) return '0';
  return num % 1 === 0 ? String(num) : num.toFixed(3).replace(/\.?0+$/, '');
}

// Returns converted qty, or null if the units aren't both convertible weights.
function pkConvWeight(qty, from, to) {
  if (pkSameUnit(from, to)) return qty;
  const f = pkWtFactor(from), t = pkWtFactor(to);
  if (f && t) return qty * (f / t);
  return null;
}

/* ── FIFO layer selection ───────────────────────────────────────
 * Which purchase is the stock on hand currently being drawn from? Sum every
 * purchase, subtract what's left, and walk oldest→newest until the running
 * total exceeds what's been consumed.
 *
 * Everything is converted into the product's stocking unit first. Summing a
 * supplier's 50 lb sacks with another's 10 kg bags raw makes the total (and so
 * the "consumed" figure, and so the chosen layer) wrong — the app would apply
 * the newer supplier's price while you're still eating the older stock.
 *
 * Lives here because recipes.js, finished-products.js and inventory.js all
 * need it; they previously each had their own copy and had already drifted.
 */

// Quantity one purchase brought into stock, expressed in `toUnit`.
// null when it can't be converted (caller skips it rather than guessing).
function fifoEntryQtyIn(entry, toUnit, avgWeightKg) {
  let pQty = (entry.pack_qty != null && entry.pack_qty !== '')
    ? parseFloat(entry.pack_qty)
    : parseFloat((String(entry.pack_size || '').match(/^([\d.]+)/) || [])[1]);
  if (!(pQty > 0)) pQty = 1;
  const ordered = parseFloat(entry.qty_ordered) || 1;
  const raw     = pQty * ordered;

  const fromUnit = String(
    entry.pack_unit || (String(entry.pack_size || '').match(/[\d.]+\s*(.+)$/) || [])[1] || ''
  ).trim();

  // No unit on either side — nothing to reconcile, use the raw figure.
  if (!toUnit || !fromUnit) return raw;
  const conv = invConvertQty(raw, fromUnit, toUnit, avgWeightKg);
  return conv.error ? null : conv.qty;
}

// The entry whose batch is currently being consumed, or null for no entries.
// Purchases that can't be expressed in `toUnit` are skipped for layer selection
// (they can't be placed on the same axis); if none can be converted, falls back
// to the newest entry so costing still resolves to something.
function fifoActiveEntryIn(sortedEntries, invQty, toUnit, avgWeightKg) {
  if (!sortedEntries || !sortedEntries.length) return null;

  const usable = [];
  for (const e of sortedEntries) {
    const q = fifoEntryQtyIn(e, toUnit, avgWeightKg);
    if (q != null) usable.push({ entry: e, qty: q });
  }
  if (!usable.length) return sortedEntries[sortedEntries.length - 1];

  let totalPurchased = 0;
  for (const u of usable) totalPurchased += u.qty;

  const consumed = Math.max(0, totalPurchased - Math.max(0, invQty));

  let cumulative = 0;
  for (const u of usable) {
    cumulative += u.qty;
    if (cumulative > consumed) return u.entry;
  }
  return usable[usable.length - 1].entry;
}

/* ── Shared quantity conversion ─────────────────────────────────
 * Products may be invoiced in a different unit than they're stocked in (one
 * supplier bills potatoes in kg, another in lb — see migration 0032). Anything
 * moving a physical quantity between units goes through here so there is one
 * conversion table rather than one per page.
 * Covers weight↔weight, volume↔volume, and each→weight via the product's
 * average weight per unit. Returns { qty } or { error }; callers must treat an
 * error as "cannot do this", never as a silent factor of 1.
 */
const _INV_UNIT_FACTORS = {
  kg:  { dim: 'weight', factor: 1 },
  g:   { dim: 'weight', factor: 0.001 },
  lb:  { dim: 'weight', factor: 0.45359237 },
  lbs: { dim: 'weight', factor: 0.45359237 },
  oz:  { dim: 'weight', factor: 0.0283495231 },   // WEIGHT ounce; fluid ounce is 'fl oz'
  l:   { dim: 'volume', factor: 1 },
  ml:  { dim: 'volume', factor: 0.001 },
  'fl oz': { dim: 'volume', factor: 0.0295735296 },
  gal: { dim: 'volume', factor: 3.78541178 },
};

function invUnitInfo(u) {
  return _INV_UNIT_FACTORS[String(u || '').trim().toLowerCase()] || null;
}
function invSameUnit(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}
function invIsEachUnit(u) {
  const s = String(u || '').trim().toLowerCase();
  return s === 'each' || s === 'ea' || s === 'unit';
}

// Convert a PER-UNIT COST between units ($1.50/lb → $3.31/kg) — the reciprocal
// of invConvertQty. Returns { cost } or { error }. Mirrors convertUnitCost() in
// src/index.ts, which the worker needs its own copy of.
function invConvertUnitCost(cost, fromUnit, toUnit, avgWeightPerUnit) {
  if (invSameUnit(fromUnit, toUnit)) return { cost };

  const from = invUnitInfo(fromUnit);
  const to   = invUnitInfo(toUnit);

  if (invIsEachUnit(fromUnit) && to && to.dim === 'weight') {
    if (!avgWeightPerUnit || avgWeightPerUnit <= 0) {
      return { error: 'Set "Average Weight per Unit" on the product to enable this conversion' };
    }
    return { cost: (cost / avgWeightPerUnit) * to.factor };
  }
  if (from && from.dim === 'weight' && invIsEachUnit(toUnit)) {
    if (!avgWeightPerUnit || avgWeightPerUnit <= 0) {
      return { error: 'Set "Average Weight per Unit" on the product to enable this conversion' };
    }
    return { cost: (cost / from.factor) * avgWeightPerUnit };
  }
  if (from && to && from.dim === to.dim) {
    return { cost: cost * (to.factor / from.factor) };
  }
  return { error: `Cannot convert ${fromUnit} to ${toUnit}` };
}

function invConvertQty(qty, fromUnit, toUnit, avgWeightPerUnit) {
  if (invSameUnit(fromUnit, toUnit)) return { qty };

  const from = invUnitInfo(fromUnit);
  const to   = invUnitInfo(toUnit);

  // Each → weight: qty items × kg each, expressed in toUnit.
  if (invIsEachUnit(fromUnit) && to && to.dim === 'weight') {
    if (!avgWeightPerUnit || isNaN(avgWeightPerUnit) || avgWeightPerUnit <= 0) {
      return { error: 'Set "Average Weight per Unit" on the product to enable this conversion' };
    }
    return { qty: (qty * avgWeightPerUnit) / to.factor };
  }

  // Weight → each: the reciprocal.
  if (from && from.dim === 'weight' && invIsEachUnit(toUnit)) {
    if (!avgWeightPerUnit || isNaN(avgWeightPerUnit) || avgWeightPerUnit <= 0) {
      return { error: 'Set "Average Weight per Unit" on the product to enable this conversion' };
    }
    return { qty: (qty * from.factor) / avgWeightPerUnit };
  }

  if (from && to && from.dim === to.dim) {
    return { qty: qty * (from.factor / to.factor) };
  }

  return { error: `Cannot convert ${fromUnit} to ${toUnit}` };
}

// generic_products row → pack config, or null when the product doesn't use
// pack levels. The *presence of a level's weight* is the on/off signal.
function pkConfigFrom(g) {
  if (!g) return null;
  const midLb = g.mid_lb != null ? Number(g.mid_lb) : null;
  const topLb = g.top_lb != null ? Number(g.top_lb) : null;
  const hasMid = midLb != null && midLb > 0;
  const hasTop = topLb != null && topLb > 0;
  if (!hasMid && !hasTop) return null;
  return {
    base_unit: g.base_unit || 'lb',
    mid_name: g.mid_name || 'bag', mid_lb: hasMid ? midLb : null,
    top_name: g.top_name || 'case', top_lb: hasTop ? topLb : null,
  };
}

// Pack config for a row, but only when it can be safely reconciled to that
// row's stored unit (same unit, or both convertible weights). Otherwise the
// caller falls back to a plain single-quantity input.
function pkInfoFor(config, rowUnit) {
  if (!config) return null;
  const base = config.base_unit || 'lb';
  if (!pkSameUnit(base, rowUnit) && pkConvWeight(1, base, rowUnit) === null) return null;
  return { ...config, base_unit: base };
}

function pkAnyEntered(state) {
  const bs = state || {};
  return ['top', 'mid', 'base'].some(k => String(bs[k] || '').trim() !== '' && !isNaN(parseFloat(bs[k])));
}

// Total in the base weight unit (top·top_lb + mid·mid_lb + loose base).
function pkTotalBase(state, pack) {
  const bs = state || {};
  let total = parseFloat(bs.base) || 0;
  if (pack.top_lb != null) total += (parseFloat(bs.top) || 0) * pack.top_lb;
  if (pack.mid_lb != null) total += (parseFloat(bs.mid) || 0) * pack.mid_lb;
  return total;
}

// Total converted into `unit`. null when nothing has been entered yet.
function pkTotalIn(state, pack, unit) {
  if (!pkAnyEntered(state)) return null;
  const base = pkTotalBase(state, pack);
  const conv = pkConvWeight(base, pack.base_unit, unit);
  return pkRound6(conv === null ? base : conv);
}

// Split a base-unit amount back into whole top/mid units plus a loose
// remainder — used to prefill the boxes from an existing quantity.
function pkSplitBase(baseQty, pack) {
  let rest = Math.max(0, Number(baseQty) || 0);
  const out = { top: '', mid: '', base: '' };
  if (pack.top_lb != null && pack.top_lb > 0) {
    const n = Math.floor(pkRound6(rest / pack.top_lb));
    if (n > 0) { out.top = String(n); rest = pkRound6(rest - n * pack.top_lb); }
  }
  if (pack.mid_lb != null && pack.mid_lb > 0) {
    const n = Math.floor(pkRound6(rest / pack.mid_lb));
    if (n > 0) { out.mid = String(n); rest = pkRound6(rest - n * pack.mid_lb); }
  }
  if (rest > 0 || (!out.top && !out.mid)) out.base = String(pkRound6(rest));
  return out;
}

function pkBox(key, level, label, val, hint, inputClass) {
  return `
    <label class="st-pack-box">
      <input type="number" step="any" inputmode="decimal" class="st-input ${inputClass}"
             data-pack-key="${esc(key)}" data-level="${esc(level)}"
             value="${esc(val)}" placeholder="0" />
      <span class="st-pack-lbl">${esc(label)}${hint ? `<span class="st-pack-hint"> · ${esc(hint)} ea</span>` : ''}</span>
    </label>`;
}

/**
 * One box per active pack level (top → mid → base) plus a live running total.
 *
 * key         — identifier echoed back on each input as data-pack-key
 * pack        — result of pkInfoFor()
 * unit        — the unit the total should be displayed in (the row's own unit)
 * state       — current box state
 * inputClass  — class the caller binds its 'input' listener to
 */
function pkBoxesHtml({ key, pack, unit, state, inputClass = 'pk-pack-input' }) {
  const bs = state || { top: '', mid: '', base: '' };
  const boxes = [];
  if (pack.top_lb != null) boxes.push(pkBox(key, 'top', pack.top_name, bs.top, `${pkFmtQty(pack.top_lb)} ${pack.base_unit}`, inputClass));
  if (pack.mid_lb != null) boxes.push(pkBox(key, 'mid', pack.mid_name, bs.mid, `${pkFmtQty(pack.mid_lb)} ${pack.base_unit}`, inputClass));
  boxes.push(pkBox(key, 'base', `loose ${pack.base_unit}`, bs.base, '', inputClass));
  const total = pkTotalIn(bs, pack, unit);
  return `
    <div class="st-pack">
      ${boxes.join('')}
      <div class="st-pack-total">= <strong data-pack-total="${esc(key)}">${total === null ? '0' : pkFmtQty(total)}</strong> ${esc(unit || pack.base_unit)}</div>
    </div>`;
}
