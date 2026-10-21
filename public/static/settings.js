// ===== settings.js — customer Settings page =====
// Two things live here: your own account (email, change password — reuses
// the existing modal from utils.js, nothing new) and Team (invite people via
// a copy-link, see who's active, revoke a pending invite, deactivate someone
// who's left). No auto-approve here — that's a separate, bigger piece of
// work (a new server-side invoice-commit engine) and is not part of this page.

let currentUserId = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadAccount();
  loadPlan();
  loadBilling();
  await loadTeam();

  document.getElementById('changePwBtn').addEventListener('click', () => {
    openChangePasswordModal();
  });

  document.getElementById('openInviteBtn').addEventListener('click', () => {
    document.getElementById('inviteName').value = '';
    document.getElementById('inviteEmail').value = '';
    document.getElementById('inviteMsg').className = 'msg';
    document.getElementById('inviteMsg').textContent = '';
    document.getElementById('inviteResult').classList.add('hidden');
    openModal('inviteModal');
  });
  document.getElementById('closeInviteModal').addEventListener('click', () => closeModal('inviteModal'));
  document.getElementById('cancelInviteModal').addEventListener('click', () => closeModal('inviteModal'));
  document.getElementById('generateInviteBtn').addEventListener('click', generateInvite);
  document.getElementById('copyInviteLinkBtn').addEventListener('click', copyInviteLink);
  document.getElementById('mgrEditKitchen').addEventListener('change', e =>
    saveRoleSwitch('manager', null, e.target, { managers_edit_kitchen: e.target.checked }));
});

async function loadAccount() {
  try {
    const r = await fetch('/api/auth/me');
    if (!r.ok) return; // not signed in — nothing more to show on this page
    const d = await r.json();
    if (d.user) {
      currentUserId = d.user.id;
      document.getElementById('myEmail').value = d.user.email || '';
    }
  } catch (_) { /* ignore — page still renders, just without the email filled in */ }
}

// ── Plan & usage ────────────────────────────────────────────
const PRO_FEATURE_LABELS = {
  inventory_tools: 'Inventory and stock adjustments',
  stock_takes:     'Stock counts with variance',
  storage_layout:  'Storage layout',
  staff:           'Staff certifications',
  true_cogs:       'True cost of goods on the P&L',
  pos_sales:       'POS sales import',
};

function fmtResetDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return isNaN(d) ? iso : d.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

async function loadPlan() {
  const body = document.getElementById('planBody');
  try {
    const p = await apiGet('account/plan');
    const { used, cap, resets_on } = p.invoice_reads;

    let usage;
    if (cap > 0) {
      const pct = Math.min(100, Math.round((used / cap) * 100));
      const cls = used >= cap ? 'full' : pct >= 80 ? 'warn' : '';
      usage = `
        <div class="usage-line"><strong>${used}</strong> of <strong>${cap}</strong> invoice reads used this month</div>
        <div class="meter ${cls}"><span style="width:${pct}%"></span></div>
        <div class="team-sub">Resets on ${esc(fmtResetDate(resets_on))}.${used >= cap
          ? ' You can still add invoices by hand until then.' : ''}</div>`;
    } else {
      usage = `
        <div class="usage-line"><strong>${used}</strong> invoice read${used === 1 ? '' : 's'} this month</div>
        <div class="team-sub">No monthly limit on your plan.</div>`;
    }

    const atCap = cap > 0 && used >= cap;
    const mail = (subject) => 'mailto:hello@foodnance.com?subject=' + encodeURIComponent(subject);
    const features = (p.pro_features || []).map(f => PRO_FEATURE_LABELS[f]).filter(Boolean);
    // Two separate asks, each with a button that says what the email will say:
    // more reads on this plan, or the plan that has no monthly limit.
    const raise = atCap ? `
      <div class="upsell">
        <strong>Need more reads this month?</strong>
        <div style="margin-top:.6rem"><a class="btn btn-primary" href="${mail('Raise my invoice limit')}"><i class="fas fa-envelope"></i> Ask to raise your limit</a></div>
      </div>` : '';
    const upsell = features.length ? `
      <div class="upsell">
        <strong>Pro also adds</strong>
        <ul>${features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        <a class="btn ${atCap ? 'btn-ghost' : 'btn-primary'}" href="${mail('Upgrade to Pro')}"><i class="fas fa-envelope"></i> Ask about Pro</a>
      </div>` : '';

    body.innerHTML = `
      <div class="plan-head"><span class="plan-badge">${esc(p.label)}</span><span class="team-sub">Your current plan</span></div>
      ${usage}
      ${raise}
      ${upsell}`;
  } catch (e) {
    // A super-admin with no restaurant selected has nothing to show; anything
    // else is a real failure worth saying so.
    if (/No organization/i.test(e.message || '')) document.getElementById('planCard').classList.add('hidden');
    else body.innerHTML = `<p class="team-sub">Could not load your plan — ${esc(e.message || 'try again')}</p>`;
  }
}

// ─── Billing (owner only) ─────────────────────────────────────
// GET /api/billing/summary answers 403 for anyone but the owner, so the box
// simply stays hidden for them. Where payments are off and the account isn't
// "no payment needed", there is nothing to show either.
const CARD_BRANDS = { visa: 'Visa', mastercard: 'Mastercard', american_express: 'American Express',
  discover: 'Discover', jcb: 'JCB', diners_club: 'Diners Club', union_pay: 'UnionPay', maestro: 'Maestro' };

function billingDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function billingCardText(card) {
  if (!card) return '';
  if (card.type === 'paypal') return 'PayPal';
  if (card.type !== 'card') return esc(card.type);
  const brand = CARD_BRANDS[card.brand] || (card.brand ? card.brand[0].toUpperCase() + card.brand.slice(1) : 'Card');
  const exp = card.expiry_month && card.expiry_year
    ? `, expires ${String(card.expiry_month).padStart(2, '0')}/${String(card.expiry_year).slice(-2)}` : '';
  return `${esc(brand)} ending ${esc(card.last4)}${esc(exp)}`;
}

function billingStatusText(b) {
  const next = billingDate(b.next_at);
  if (b.change === 'cancel' && b.change_at) return `Cancels on ${billingDate(b.change_at)}. Nothing more will be charged.`;
  if (b.change === 'pause' && b.change_at) return `Pauses on ${billingDate(b.change_at)}.`;
  switch (b.status) {
    case 'trialing': return next ? `Free trial. First payment on ${next}.` : 'Free trial.';
    case 'active':   return next ? `Paid up. Next payment on ${next}.` : 'Paid up.';
    case 'past_due': return 'Your last payment didn’t go through.';
    case 'paused':   return 'Paused. No payments are being taken.';
    case 'canceled': return 'Cancelled.';
    default:         return 'No card on file yet.';
  }
}

async function loadBilling() {
  const card = document.getElementById('billingCard');
  const body = document.getElementById('billingBody');
  let b;
  try { b = await apiGet('billing/summary'); }
  catch (e) { card.classList.add('hidden'); return; }   // not the owner, or no account
  if (!b.configured && !b.exempt) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  if (b.exempt && !b.has_subscription) {
    body.innerHTML = `<p class="team-sub" style="font-size:.9rem">This account is set up without online billing, so there is no card to manage. Questions about it go to <a href="mailto:billing@foodnance.com">billing@foodnance.com</a>.</p>`;
    return;
  }

  const rows = [
    ['Plan', esc(b.plan_label)],
    ['Status', esc(billingStatusText(b))],
  ];
  if (b.card) rows.push(['Card', billingCardText(b.card)]);
  else if (b.card_unavailable) rows.push(['Card', '<span class="team-sub">Couldn’t load it just now.</span>']);
  body.innerHTML = `
    ${b.status === 'past_due' ? `<div class="billing-warn"><i class="fas fa-triangle-exclamation"></i>
      Your last payment didn’t go through. Our payment provider will try again; updating your card now fixes it straight away.</div>` : ''}
    ${rows.map(([k, v]) => `<div class="billing-row"><span class="k">${k}</span><span>${v}</span></div>`).join('')}
    <div class="billing-actions">
      ${b.can_update_card ? `<button class="btn btn-primary" id="updateCardBtn"><i class="fas fa-credit-card"></i> Update card</button>` : ''}
      ${b.can_open_portal ? `<button class="btn btn-secondary" id="billingPortalBtn"><i class="fas fa-receipt"></i> Receipts and billing</button>` : ''}
    </div>
    <p class="team-sub billing-note">Payments are handled by Paddle, our reseller. We never see your card number.
      Receipts and billing opens Paddle’s page, where you can download invoices or cancel.</p>`;
  document.getElementById('updateCardBtn')?.addEventListener('click', updateCard);
  document.getElementById('billingPortalBtn')?.addEventListener('click', openBillingPortal);
}

let _paddleReady = null;
function loadPaddleJs(environment, token) {
  if (_paddleReady) return _paddleReady;
  _paddleReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    s.onload = () => {
      if (environment === 'sandbox') window.Paddle.Environment.set('sandbox');
      window.Paddle.Initialize({ token, eventCallback: onPaddleEvent });
      resolve(window.Paddle);
    };
    s.onerror = () => { _paddleReady = null; reject(new Error('Could not load the payment window. Check your connection and try again.')); };
    document.head.appendChild(s);
  });
  return _paddleReady;
}

function onPaddleEvent(ev) {
  if (ev?.name !== 'checkout.completed') return;
  setTimeout(() => { try { window.Paddle.Checkout.close(); } catch (_) {} }, 1500);
  showToast('Card updated.', 'success');
  // Paddle's confirmation reaches the server a moment later.
  setTimeout(loadBilling, 4000);
}

async function updateCard() {
  const btn = document.getElementById('updateCardBtn');
  btn.disabled = true;
  try {
    const d = await apiPost('billing/update-card', {});
    const Paddle = await loadPaddleJs(d.environment, d.client_token);
    Paddle.Checkout.open({
      transactionId: d.transaction_id,
      settings: { displayMode: 'overlay', theme: 'light', locale: 'en', allowLogout: false },
    });
  } catch (e) {
    showToast(e.message || 'Could not open the payment window.', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function openBillingPortal() {
  const btn = document.getElementById('billingPortalBtn');
  // Opened now, inside the click, or the browser blocks it as a pop-up; it is
  // pointed at Paddle's page once the link arrives.
  const win = window.open('', '_blank');
  btn.disabled = true;
  try {
    const d = await apiPost('billing/portal', {});
    if (win) { win.opener = null; win.location = d.url; } else { location.href = d.url; }
  } catch (e) {
    if (win) win.close();
    showToast(e.message || 'Could not open the billing page.', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ─── Team roles (migration 0067) ─────────────────────────────
const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', kitchen: 'Kitchen staff' };
const ROLE_RANK = { kitchen: 1, manager: 2, owner: 3, super_admin: 4 };
const SWITCH_LABELS = {
  prices:          'See prices and costs',
  invoice_upload:  'Upload invoices',
  invoice_approve: 'Approve invoices',
  invoice_void:    'Void or delete invoices',
  pnl:             'See the profit and loss',
  catalog:         'Edit products, recipes and suppliers',
  stock:           'Stock counts and recording waste',
  pos:             'Import till sales',
  invite:          'Invite teammates',
};
let teamRoles = null;   // the `roles` block of GET /api/team

function roleLabel(role) { return ROLE_LABELS[role] || ROLE_LABELS.kitchen; }

// The owner picks a teammate's role in place; everyone else just reads it.
function roleCell(u) {
  if (u.role === 'owner' || !teamRoles?.can_change_roles) return esc(roleLabel(u.role));
  return `<select class="role-select" data-id="${esc(u.id)}" aria-label="Role">
      ${['manager', 'kitchen'].map(r => `<option value="${r}"${r === u.role ? ' selected' : ''}>${roleLabel(r)}</option>`).join('')}
    </select>`;
}

async function changeRole(sel) {
  const was = sel.dataset.was;
  sel.disabled = true;
  try {
    await apiPost(`team/${sel.dataset.id}/role`, { role: sel.value });
    sel.dataset.was = sel.value;
    showToast(`Now ${roleLabel(sel.value)}.`, 'success');
  } catch (e) {
    sel.value = was;
    showToast(e.message || 'Could not change the role.', 'error');
  } finally {
    sel.disabled = false;
  }
}

function renderRoleSwitches() {
  const body = document.getElementById('rolesBody');
  const r = teamRoles;
  if (!r) return;
  body.innerHTML = r.switches.map(p => `
    <tr>
      <td>${esc(SWITCH_LABELS[p] || p)}</td>
      ${['manager', 'kitchen'].map(role => `
        <td><input type="checkbox" data-role="${role}" data-perm="${esc(p)}"
              ${r.settings[role][p] ? 'checked' : ''} ${r.can_edit[role] ? '' : 'disabled'}
              aria-label="${esc(roleLabel(role))}: ${esc(SWITCH_LABELS[p] || p)}"></td>`).join('')}
    </tr>`).join('');
  body.querySelectorAll('input[type=checkbox]').forEach(box => {
    box.addEventListener('change', () =>
      saveRoleSwitch(box.dataset.role, box.dataset.perm, box, { permissions: { [box.dataset.perm]: box.checked } }));
  });

  const isOwner = r.my_role === 'owner' || r.my_role === 'super_admin';
  document.getElementById('mgrEditKitchenRow').classList.toggle('hidden', !isOwner);
  document.getElementById('mgrEditKitchen').checked = !!r.settings.managers_edit_kitchen;
  document.getElementById('rolesIntro').textContent = isOwner
    ? 'You can do everything, including billing and changing these switches. Changes apply to everyone with that role straight away.'
    : (r.can_edit.kitchen
      ? 'The owner can do everything. You can change what Kitchen staff can do; only the owner can change Managers.'
      : 'The owner can do everything and decides what each role can do. Ask them if you need something switched on.');
}

async function saveRoleSwitch(role, perm, box, payload) {
  box.disabled = true;
  try {
    const d = await apiPost('team/permissions', { role, ...payload });
    teamRoles.settings = d.settings;
    showToast('Saved.', 'success');
  } catch (e) {
    box.checked = !box.checked;
    showToast(e.message || 'Could not save that change.', 'error');
  } finally {
    box.disabled = false;
  }
}

async function loadTeam() {
  const teamBody = document.getElementById('teamBody');
  const pendingWrap = document.getElementById('pendingWrap');
  const pendingBody = document.getElementById('pendingBody');
  try {
    const data = await apiGet('team');
    const users = data.users || [];
    const invites = data.invites || [];
    teamRoles = data.roles || null;
    renderRoleSwitches();
    const myRank = ROLE_RANK[teamRoles?.my_role] || 0;
    // Deactivate: needs "Invite teammates", never the owner, never above your own role.
    const canRemove = u => roleAllows('invite') && u.role !== 'owner' && (ROLE_RANK[u.role] || 1) <= myRank;
    const inviteRole = document.getElementById('inviteRole');
    inviteRole.innerHTML = (teamRoles?.invitable || ['kitchen'])
      .map(r => `<option value="${r}">${roleLabel(r)}</option>`).join('');

    teamBody.innerHTML = users.length
      ? users.map(u => `
        <tr>
          <td>${esc(u.name || '—')}</td>
          <td>${esc(u.email)}</td>
          <td>${u.id === currentUserId ? esc(roleLabel(u.role)) : roleCell(u)}</td>
          <td>${fmtDate(u.created_at)}</td>
          <td class="actions">
            ${u.id === currentUserId
              ? '<span class="team-sub">This is you</span>'
              : canRemove(u) ? `<button class="btn btn-ghost" data-act="archive" data-id="${esc(u.id)}" data-name="${esc(u.name || u.email)}">
                   <i class="fas fa-user-slash"></i> Deactivate
                 </button>` : ''}
          </td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="empty-row">No one yet.</td></tr>';

    teamBody.querySelectorAll('select.role-select').forEach(sel => {
      sel.dataset.was = sel.value;
      sel.addEventListener('change', () => changeRole(sel));
    });

    teamBody.querySelectorAll('button[data-act="archive"]').forEach(btn => {
      btn.addEventListener('click', () => archiveTeammate(btn.dataset.id, btn.dataset.name));
    });

    if (invites.length) {
      pendingWrap.classList.remove('hidden');
      pendingBody.innerHTML = invites.map(i => `
        <tr class="pending-row">
          <td>${esc(i.name || '—')}</td>
          <td>${esc(i.email || '—')}</td>
          <td>${esc(roleLabel(i.role))}</td>
          <td>${fmtDate(i.created_at)}</td>
          <td>${isExpired(i.expires_at) ? '<strong>Expired</strong>' : (i.expires_at ? fmtDate(i.expires_at) : '—')}</td>
          <td class="actions">
            ${i.email ? `<button class="btn btn-ghost" data-act="resend" data-id="${esc(i.id)}" data-email="${esc(i.email)}" title="Email this invitation again">
              <i class="fas fa-paper-plane"></i> Resend
            </button>` : ''}
            <button class="btn btn-ghost" data-act="copy" data-token="${esc(i.token)}" title="Copy the link again">
              <i class="fas fa-copy"></i>
            </button>
            <button class="btn btn-ghost" data-act="revoke" data-id="${esc(i.id)}">
              <i class="fas fa-trash"></i> Revoke
            </button>
          </td>
        </tr>`).join('');

      pendingBody.querySelectorAll('button[data-act="copy"]').forEach(btn => {
        btn.addEventListener('click', () => copyText(inviteLinkFor(btn.dataset.token), 'Link copied.'));
      });
      pendingBody.querySelectorAll('button[data-act="resend"]').forEach(btn => {
        btn.addEventListener('click', () => resendInvite(btn, btn.dataset.id, btn.dataset.email));
      });
      pendingBody.querySelectorAll('button[data-act="revoke"]').forEach(btn => {
        btn.addEventListener('click', () => revokeInvite(btn.dataset.id));
      });
    } else {
      pendingWrap.classList.add('hidden');
      pendingBody.innerHTML = '';
    }
  } catch (e) {
    teamBody.innerHTML = `<tr><td colspan="5" class="empty-row">Could not load — ${esc(e.message)}</td></tr>`;
  }
}

function inviteLinkFor(token) {
  return `${location.origin}/accept-invite.html?token=${encodeURIComponent(token)}`;
}

async function generateInvite() {
  const msgEl = document.getElementById('inviteMsg');
  const btn = document.getElementById('generateInviteBtn');
  msgEl.className = 'msg'; msgEl.textContent = '';
  document.getElementById('inviteResult').classList.add('hidden');
  const name = document.getElementById('inviteName').value.trim();
  const email = document.getElementById('inviteEmail').value.trim();

  if (!name || !email.includes('@')) {
    msgEl.textContent = !name ? 'Enter their name.' : 'Enter a valid email address.';
    msgEl.className = 'msg show bad';
    return;
  }

  // Every click creates an invite and sends an email, so a double-click must
  // not make two.
  btn.disabled = true;
  try {
    const role = document.getElementById('inviteRole').value || 'kitchen';
    const d = await apiPost('team/invite', { name, email, role });
    if (d.emailed) {
      msgEl.textContent = `Invitation emailed to ${email}.`;
      msgEl.className = 'msg show good';
      // Ready for the next person.
      document.getElementById('inviteName').value = '';
      document.getElementById('inviteEmail').value = '';
    } else {
      // The invite exists either way; only the email failed. The link is the
      // fallback so it isn't lost — and it stays in the pending list below.
      msgEl.textContent = `The invite was created, but we couldn't email it. ${d.email_error || ''}`.trim();
      msgEl.className = 'msg show bad';
      document.getElementById('inviteLink').textContent = inviteLinkFor(d.token);
      document.getElementById('inviteResult').classList.remove('hidden');
    }
    await loadTeam();
  } catch (e) {
    msgEl.textContent = e.message || 'Could not create the invite.';
    msgEl.className = 'msg show bad';
  } finally {
    btn.disabled = false;
  }
}

function copyInviteLink() {
  copyText(document.getElementById('inviteLink').textContent, 'Link copied.');
}

async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(okMessage, 'success');
  } catch (_) {
    showToast('Could not copy — select and copy the link manually.', 'error');
  }
}

// invites.expires_at is UTC 'YYYY-MM-DD HH:MM:SS' (SQLite datetime('now')).
function isExpired(expiresAt) {
  if (!expiresAt) return false;
  const t = Date.parse(String(expiresAt).replace(' ', 'T') + 'Z');
  return !isNaN(t) && t < Date.now();
}

async function resendInvite(btn, id, email) {
  btn.disabled = true;
  try {
    await apiPost(`team/invites/${id}/resend`, {});
    showToast(`Invitation emailed to ${email}.`, 'success');
    await loadTeam();
  } catch (e) {
    showToast(e.message || 'Could not send the email.', 'error');
    btn.disabled = false;
  }
}

async function revokeInvite(id) {
  if (!confirm('Revoke this invite? The link will stop working.')) return;
  try {
    await apiPost(`team/invites/${id}/revoke`, {});
    showToast('Invite revoked.', 'success');
    await loadTeam();
  } catch (e) {
    showToast(e.message || 'Could not revoke the invite.', 'error');
  }
}

async function archiveTeammate(id, name) {
  if (!confirm(`Deactivate ${name}? They'll lose access immediately — this can't be undone from here.`)) return;
  try {
    await apiPost(`team/${id}/archive`, {});
    showToast('Deactivated.', 'success');
    await loadTeam();
  } catch (e) {
    showToast(e.message || 'Could not deactivate that person.', 'error');
  }
}
