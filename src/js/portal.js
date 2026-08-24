import { logout } from '/js/vendor/netlify-identity.js';

const $ = (id) => document.getElementById(id);
let profile = null;
let accounts = [];
let accountsLoaded = false;

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.replace('/login/');
    throw new Error('Not signed in');
  }
  if (!response.ok) {
    const error = new Error(body.error || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return body;
}

function setStatus(element, message, type = 'info') {
  if (!element) return;
  element.textContent = message;
  element.className = 'account-status ' + type;
}

function statusLabel(status) {
  return (
    {
      pending: 'Awaiting approval',
      active: 'Approved',
      denied: 'Not approved',
      suspended: 'Access suspended',
    }[status] || status
  );
}

function renderProfile() {
  const displayName = profile.display_name || profile.email || 'Portal member';
  const firstName = displayName.split(/\s+/)[0] || displayName;
  $('headerMemberName').textContent = displayName;
  $('sidebarMemberName').textContent = displayName;
  $('sidebarMemberEmail').textContent = profile.email;
  $('dashboardMemberName').textContent = firstName;

  $('profileName').value = profile.display_name || '';
  $('profileEmail').value = profile.email || '';
  $('profilePhone').value = profile.phone || '';
  $('profileOrganization').value = profile.organization || '';
  $('profileReason').value = profile.request_reason || '';

  const pill = $('accountStatusPill');
  pill.textContent = statusLabel(profile.status);
  pill.className = 'portal-status-pill ' + profile.status;

  const content = {
    pending: {
      heading: 'Your request is waiting for review',
      message:
        'A ministry coordinator will review your profile. You can update your information while you wait.',
    },
    active: {
      heading: 'Your portal access is active',
      message:
        'Your account has been approved. New volunteer resources will appear here as they are added.',
    },
    denied: {
      heading: 'Your request was not approved',
      message:
        'You can update your profile if information was missing, or contact D.A.R.E. Ministries with questions.',
    },
    suspended: {
      heading: 'Your portal access is suspended',
      message: 'Contact a ministry coordinator if you believe this is an error.',
    },
  }[profile.status];

  $('accountStatusHeading').textContent = content?.heading || 'Account status';
  $('accountStatusMessage').textContent = content?.message || '';
  $('memberToolsMessage').textContent =
    profile.status === 'active'
      ? 'Additional volunteer tools will appear here as they are planned and approved.'
      : 'Private volunteer tools will become available after your account is approved.';

  const decision = $('accountDecisionMessage');
  decision.textContent = profile.decision_message || '';
  decision.classList.toggle('hidden', !profile.decision_message);

  const coordinator = profile.role === 'coordinator' && profile.status === 'active';
  $('coordinatorNavigation').classList.toggle('hidden', !coordinator);
  $('coordinatorDashboardCard').classList.toggle('hidden', !coordinator);
}

function openView(viewName) {
  if (viewName === 'access' && profile.role !== 'coordinator') return;

  document.querySelectorAll('.portal-view').forEach((view) => {
    view.hidden = view.dataset.view !== viewName;
  });
  document.querySelectorAll('[data-portal-view]').forEach((control) => {
    control.classList.toggle('active', control.dataset.portalView === viewName);
  });
  window.history.replaceState(null, '', viewName === 'dashboard' ? '/portal/' : '#' + viewName);
  closeMobileMenu();

  if (viewName === 'access' && !accountsLoaded) loadAccounts();
  document.querySelector('.portal-main')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('[data-portal-view]').forEach((control) => {
  control.addEventListener('click', () => openView(control.dataset.portalView));
});

function openMobileMenu() {
  $('portalSidebar').classList.add('open');
  $('portalBackdrop').classList.add('open');
  $('portalMenuToggle').setAttribute('aria-expanded', 'true');
}

function closeMobileMenu() {
  $('portalSidebar').classList.remove('open');
  $('portalBackdrop').classList.remove('open');
  $('portalMenuToggle').setAttribute('aria-expanded', 'false');
}

$('portalMenuToggle').addEventListener('click', () => {
  if ($('portalSidebar').classList.contains('open')) closeMobileMenu();
  else openMobileMenu();
});
$('portalBackdrop').addEventListener('click', closeMobileMenu);

$('portalLogout').addEventListener('click', async () => {
  $('portalLogout').disabled = true;
  try {
    await logout();
  } catch {
    // Navigate away even if server-side session invalidation is unavailable.
  }
  window.location.replace('/login/?signedOut=1');
});

$('portalProfileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Saving...';
  setStatus($('profileStatus'), '');
  try {
    const data = await api('/api/portal/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        display_name: $('profileName').value.trim(),
        phone: $('profilePhone').value.trim(),
        organization: $('profileOrganization').value.trim(),
        request_reason: $('profileReason').value.trim(),
      }),
    });
    profile = data.profile;
    renderProfile();
    setStatus($('profileStatus'), 'Your profile has been saved.', 'success');
  } catch (error) {
    setStatus($('profileStatus'), error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Save Profile';
  }
});

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value == null ? '' : String(value);
  return element.innerHTML;
}

function formatDate(value) {
  if (!value) return 'Not yet';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function accountActions(account) {
  if (account.role === 'coordinator') return '';
  if (account.status === 'pending') {
    return `
      <button class="btn btn-primary btn-small" type="button" data-account-action="approve">Approve</button>
      <button class="btn btn-danger btn-small" type="button" data-account-action="deny">Decline</button>`;
  }
  if (account.status === 'active') {
    return '<button class="btn btn-danger btn-small" type="button" data-account-action="suspend">Suspend Access</button>';
  }
  return '<button class="btn btn-primary btn-small" type="button" data-account-action="reactivate">Approve Access</button>';
}

function renderAccounts() {
  const pendingCount = accounts.filter((account) => account.status === 'pending').length;
  $('pendingBadge').textContent = pendingCount ? '(' + pendingCount + ')' : '';
  $('pendingDashboardCount').textContent = pendingCount;
  $('pendingDashboardPlural').textContent = pendingCount === 1 ? '' : 's';

  if (!accounts.length) {
    $('portalAccountList').innerHTML =
      '<p class="portal-empty">No portal accounts have been created yet.</p>';
    return;
  }

  $('portalAccountList').innerHTML = accounts
    .map(
      (account) => `
        <article class="portal-account" data-account-id="${escapeHtml(account.id)}">
          <div class="portal-account-head">
            <div>
              <h3>${escapeHtml(account.display_name)}</h3>
              <p class="portal-account-meta">Requested ${escapeHtml(formatDate(account.created_at))}</p>
            </div>
            <span class="portal-status-pill ${escapeHtml(account.status)}">${escapeHtml(statusLabel(account.status))}</span>
          </div>
          <dl class="portal-account-details">
            <div><dt>Email</dt><dd>${escapeHtml(account.email)}</dd></div>
            <div><dt>Phone</dt><dd>${escapeHtml(account.phone || 'Not provided')}</dd></div>
            <div><dt>Organization</dt><dd>${escapeHtml(account.organization || 'Not provided')}</dd></div>
            <div><dt>Last portal visit</dt><dd>${escapeHtml(formatDate(account.last_login_at))}</dd></div>
            <div class="portal-card full"><dt>Connection to D.A.R.E.</dt><dd>${escapeHtml(account.request_reason || 'Not provided')}</dd></div>
          </dl>
          ${
            account.role === 'coordinator'
              ? '<p class="portal-notice info">Coordinator access is managed in Netlify Identity.</p>'
              : `<div class="portal-decision">
                  <label for="decision-${escapeHtml(account.id)}">Message to account holder (optional)</label>
                  <textarea id="decision-${escapeHtml(account.id)}" maxlength="1000" placeholder="Explain a decline or suspension, or leave a welcome note.">${escapeHtml(account.decision_message || '')}</textarea>
                  <div class="portal-card-actions">${accountActions(account)}</div>
                </div>`
          }
        </article>`
    )
    .join('');
}

async function loadAccounts() {
  $('portalAccountList').innerHTML = '<p class="portal-empty">Loading account requests...</p>';
  try {
    const data = await api('/api/admin/user-profiles');
    accounts = data.profiles;
    accountsLoaded = true;
    renderAccounts();
  } catch (error) {
    setStatus($('accountReviewStatus'), error.message, 'error');
    $('portalAccountList').innerHTML =
      '<p class="portal-empty">Account requests could not be loaded.</p>';
  }
}

$('portalAccountList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-account-action]');
  if (!button) return;
  const card = button.closest('[data-account-id]');
  const action = button.dataset.accountAction;
  const destructive = action === 'deny' || action === 'suspend';
  if (
    destructive &&
    !window.confirm("Are you sure you want to change this person's portal access?")
  )
    return;

  card.querySelectorAll('button').forEach((item) => (item.disabled = true));
  setStatus($('accountReviewStatus'), 'Saving decision...', 'info');
  try {
    const data = await api('/api/admin/user-profiles', {
      method: 'PATCH',
      body: JSON.stringify({
        id: card.dataset.accountId,
        action,
        decision_message: card.querySelector('textarea')?.value.trim() || '',
      }),
    });
    accounts = accounts.map((account) => (account.id === data.profile.id ? data.profile : account));
    renderAccounts();
    setStatus(
      $('accountReviewStatus'),
      data.identity_synced
        ? 'The account decision has been saved.'
        : 'The account decision was saved. The person may need to sign in again before all labels update.',
      'success'
    );
  } catch (error) {
    setStatus($('accountReviewStatus'), error.message, 'error');
    card.querySelectorAll('button').forEach((item) => (item.disabled = false));
  }
});

async function boot() {
  try {
    const data = await api('/api/portal/profile');
    profile = data.profile;
    renderProfile();
    $('portalLoading').classList.add('hidden');
    $('portalShell').classList.remove('hidden');

    if (profile.role === 'coordinator') await loadAccounts();

    const initialView =
      window.location.hash === '#profile'
        ? 'profile'
        : window.location.hash === '#access' && profile.role === 'coordinator'
          ? 'access'
          : 'dashboard';
    openView(initialView);
  } catch (error) {
    if (error.message !== 'Not signed in') {
      $('portalLoading').textContent =
        'The portal could not load. Please refresh the page or try again later.';
    }
  }
}

boot();
