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
    openModal('inviteModal');
  });
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
          <td>${i.expires_at ? fmtDate(i.expires_at) : '—'}</td>
          <td class="actions">
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

async function generateInvite() {
  const msgEl = document.getElementById('inviteMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';
  const name = document.getElementById('inviteName').value.trim();
  const email = document.getElementById('inviteEmail').value.trim();

  try {
    const d = await apiPost('team/invite', { name, email });
    const link = inviteLinkFor(d.token);
    document.getElementById('inviteLink').textContent = link;
    document.getElementById('inviteResult').classList.remove('hidden');
    await loadTeam();
  } catch (e) {
    msgEl.textContent = e.message || 'Could not create the invite.';
    msgEl.className = 'msg show bad';
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
