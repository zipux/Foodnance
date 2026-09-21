// ===== settings.js — customer Settings page =====
// Two things live here: your own account (email, change password — reuses
// the existing modal from utils.js, nothing new) and Team (invite people via
// a copy-link, see who's active, revoke a pending invite, deactivate someone
// who's left). No auto-approve here — that's a separate, bigger piece of
// work (a new server-side invoice-commit engine) and is not part of this page.

let currentUserId = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadAccount();
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
    document.getElementById('inviteSendEmail').checked = true;
    syncInviteButton();
    openModal('inviteModal');
  });
  document.getElementById('inviteSendEmail').addEventListener('change', syncInviteButton);
  document.getElementById('closeInviteModal').addEventListener('click', () => closeModal('inviteModal'));
  document.getElementById('cancelInviteModal').addEventListener('click', () => closeModal('inviteModal'));
  document.getElementById('generateInviteBtn').addEventListener('click', generateInvite);
  document.getElementById('copyInviteLinkBtn').addEventListener('click', copyInviteLink);
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

async function loadTeam() {
  const teamBody = document.getElementById('teamBody');
  const pendingWrap = document.getElementById('pendingWrap');
  const pendingBody = document.getElementById('pendingBody');
  try {
    const data = await apiGet('team');
    const users = data.users || [];
    const invites = data.invites || [];

    teamBody.innerHTML = users.length
      ? users.map(u => `
        <tr>
          <td>${esc(u.name || '—')}</td>
          <td>${esc(u.email)}</td>
          <td>${fmtDate(u.created_at)}</td>
          <td class="actions">
            ${u.id === currentUserId
              ? '<span class="team-sub">This is you</span>'
              : `<button class="btn btn-ghost" data-act="archive" data-id="${esc(u.id)}" data-name="${esc(u.name || u.email)}">
                   <i class="fas fa-user-slash"></i> Deactivate
                 </button>`}
          </td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="empty-row">No one yet.</td></tr>';

    teamBody.querySelectorAll('button[data-act="archive"]').forEach(btn => {
      btn.addEventListener('click', () => archiveTeammate(btn.dataset.id, btn.dataset.name));
    });

    if (invites.length) {
      pendingWrap.classList.remove('hidden');
      pendingBody.innerHTML = invites.map(i => `
        <tr class="pending-row">
          <td>${esc(i.name || '—')}</td>
          <td>${esc(i.email || '—')}</td>
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
    teamBody.innerHTML = `<tr><td colspan="4" class="empty-row">Could not load — ${esc(e.message)}</td></tr>`;
  }
}

function inviteLinkFor(token) {
  return `${location.origin}/accept-invite.html?token=${encodeURIComponent(token)}`;
}

// "Send invite" when the box is ticked, "Create invite link" when it isn't.
function syncInviteButton() {
  const emailIt = document.getElementById('inviteSendEmail').checked;
  document.getElementById('generateInviteLabel').textContent = emailIt ? 'Send invite' : 'Create invite link';
}

async function generateInvite() {
  const msgEl = document.getElementById('inviteMsg');
  const btn = document.getElementById('generateInviteBtn');
  msgEl.className = 'msg'; msgEl.textContent = '';
  const name = document.getElementById('inviteName').value.trim();
  const email = document.getElementById('inviteEmail').value.trim();
  const sendEmail = document.getElementById('inviteSendEmail').checked;

  if (!name || !email.includes('@')) {
    msgEl.textContent = !name ? 'Enter their name.' : 'Enter a valid email address.';
    msgEl.className = 'msg show bad';
    return;
  }

  // Every click creates an invite (and possibly an email), so a double-click
  // must not make two.
  btn.disabled = true;
  try {
    const d = await apiPost('team/invite', { name, email, send_email: sendEmail });
    document.getElementById('inviteLink').textContent = inviteLinkFor(d.token);
    document.getElementById('inviteResult').classList.remove('hidden');
    if (d.emailed) {
      msgEl.textContent = `Invitation emailed to ${email}. You can also copy the link below.`;
      msgEl.className = 'msg show good';
      document.getElementById('inviteResultTitle').textContent = 'Or send this link yourself';
    } else if (sendEmail) {
      // The invite exists either way; only the email failed.
      msgEl.textContent = `The invite was created, but we couldn't email it. ${d.email_error || ''}`.trim();
      msgEl.className = 'msg show bad';
      document.getElementById('inviteResultTitle').textContent = 'Send this link to them';
    } else {
      document.getElementById('inviteResultTitle').textContent = 'Send this link to them';
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
