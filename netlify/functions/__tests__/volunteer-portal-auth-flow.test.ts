/**
 * @vitest-environment happy-dom
 *
 * Volunteer portal authentication/profile flow tests generated from the
 * Volunteer → AuthClient → NetlifyIdentity → PortalAPI → Database sequence.
 * Spec: docs/volunteer-portal-auth-seq-tests.md
 *
 * Identity, the database, browser navigation, and fetch are mocked. The suite
 * performs no real network, database, filesystem, subprocess, stream, or blob
 * operations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import authClientSource from '../../../src/js/auth-client.js?raw';
import portalClientSource from '../../../src/js/portal.js?raw';
import portalAuthSource from '../lib/portal-auth.mjs?raw';
import portalProfileSource from '../portal-profile.mjs?raw';

type AccessStatus = 'pending' | 'active' | 'denied' | 'suspended';
type PortalRole = 'member' | 'coordinator';

interface IdentityUser {
  id: string;
  email?: string;
  role?: string;
  roles?: string[];
  userMetadata?: Record<string, unknown>;
  appMetadata?: { roles?: string[]; [key: string]: unknown };
  [key: string]: unknown;
}

interface ProfileRow {
  id: string;
  identity_user_id: string;
  email: string;
  display_name: string;
  phone: string | null;
  organization: string | null;
  request_reason: string | null;
  status: AccessStatus;
  role: PortalRole;
  decision_message: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  identity_deleted_at: string | null;
}

interface DbCall {
  text: string;
  values: unknown[];
}

interface SqlDatabase {
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<ProfileRow[]>;
}

const state = vi.hoisted(() => ({
  identityUser: null as IdentityUser | null,
  getUser: vi.fn(),
  getDatabase: vi.fn(),
  db: null as SqlDatabase | null,
  dbCalls: [] as DbCall[],
  profiles: new Map<string, ProfileRow>(),
  nextProfile: 1,
  dbFailure: null as Error | null,
  provisionGate: null as Promise<void> | null,
}));

vi.mock('@netlify/identity', () => ({ getUser: state.getUser }));
vi.mock('@netlify/database', () => ({ getDatabase: state.getDatabase }));

import identityHandler from '../identity.mjs';
import portalProfileHandler from '../portal-profile.mjs';
import { NOTIFY_TIMEOUT_MS } from '../lib/helpers.mjs';
import { getOrCreateProfile, getPortalSession } from '../lib/portal-auth.mjs';

const NOW = '2026-08-23T12:00:00.000Z';
const MEMBER: IdentityUser = {
  id: 'identity-member',
  email: 'volunteer@example.com',
  userMetadata: {
    full_name: 'Volunteer Person',
    phone: '555-0100',
    organization: 'Community Church',
    request_reason: 'I help with rebuilding trips.',
  },
};
const COORDINATOR: IdentityUser = {
  id: 'identity-coordinator',
  email: 'coordinator@example.com',
  roles: ['coordinator'],
  userMetadata: { full_name: 'Ministry Coordinator' },
};

function profileId(sequence: number) {
  return `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function makeProfile(subject = MEMBER.id, overrides: Partial<ProfileRow> = {}): ProfileRow {
  const sequence = state.nextProfile++;
  return {
    id: profileId(sequence),
    identity_user_id: subject,
    email: subject === COORDINATOR.id ? COORDINATOR.email! : MEMBER.email!,
    display_name: subject === COORDINATOR.id ? 'Ministry Coordinator' : 'Volunteer Person',
    phone: null,
    organization: null,
    request_reason: null,
    status: 'pending',
    role: 'member',
    decision_message: null,
    reviewed_at: null,
    reviewed_by: null,
    created_at: NOW,
    updated_at: NOW,
    last_login_at: null,
    identity_deleted_at: null,
    ...overrides,
  };
}

async function sqlHandler(strings: TemplateStringsArray, ...values: unknown[]) {
  const text = strings.join('$').replace(/\s+/g, ' ').trim();
  state.dbCalls.push({ text, values });
  if (state.dbFailure) throw state.dbFailure;

  if (/INSERT INTO user_profiles/.test(text) && /last_login_at/.test(text)) {
    if (state.provisionGate) await state.provisionGate;
    const subject = String(values[0]);
    const coordinator = values[8] === true;
    const existing = state.profiles.get(subject);
    if (existing) {
      existing.email = String(values[1]);
      if (coordinator) {
        existing.role = 'coordinator';
        existing.status = 'active';
      } else if (existing.role === 'coordinator') {
        existing.role = 'member';
        existing.status = 'suspended';
      }
      existing.last_login_at = NOW;
      existing.updated_at = NOW;
      return [{ ...existing }];
    }

    const created = makeProfile(subject, {
      email: String(values[1]),
      display_name: String(values[2]),
      phone: (values[3] as string | null) ?? null,
      organization: (values[4] as string | null) ?? null,
      request_reason: (values[5] as string | null) ?? null,
      status: values[6] as AccessStatus,
      role: values[7] as PortalRole,
      last_login_at: NOW,
    });
    state.profiles.set(subject, created);
    return [{ ...created }];
  }

  if (/INSERT INTO user_profiles/.test(text)) {
    const subject = String(values[0]);
    const existing = state.profiles.get(subject);
    if (existing) {
      existing.email = String(values[1]);
      existing.updated_at = NOW;
      return [{ ...existing }];
    }
    const created = makeProfile(subject, {
      email: String(values[1]),
      display_name: String(values[2]),
      phone: (values[3] as string | null) ?? null,
      organization: (values[4] as string | null) ?? null,
      request_reason: (values[5] as string | null) ?? null,
    });
    state.profiles.set(subject, created);
    return [{ ...created }];
  }

  if (/identity_deleted_at = NOW\(\)/.test(text)) {
    const profile = state.profiles.get(String(values[0]));
    if (!profile) return [];
    profile.identity_deleted_at = NOW;
    profile.status = 'suspended';
    profile.updated_at = NOW;
    return [{ ...profile }];
  }

  if (/UPDATE user_profiles SET display_name/.test(text)) {
    const profile = [...state.profiles.values()].find((row) => row.id === values[4]);
    if (!profile) return [];
    profile.display_name = String(values[0]);
    profile.phone = (values[1] as string | null) ?? null;
    profile.organization = (values[2] as string | null) ?? null;
    profile.request_reason = (values[3] as string | null) ?? null;
    profile.updated_at = NOW;
    return [{ ...profile }];
  }

  return [];
}

function seedProfile(overrides: Partial<ProfileRow> = {}, subject = MEMBER.id) {
  const row = makeProfile(subject, overrides);
  state.profiles.set(subject, row);
  return row;
}

function portalRequest(method = 'GET', headers: Record<string, string> = {}) {
  return new Request('https://whofixedtheroof.com/api/portal/profile', { method, headers });
}

function portalPatchRequest(body: Record<string, unknown>, origin = 'https://whofixedtheroof.com') {
  const request = new Request('https://whofixedtheroof.com/api/portal/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // happy-dom follows the browser rule that scripts cannot set the forbidden
  // Origin header. Netlify supplies it to the function, so model that platform
  // boundary explicitly while retaining the real Request body parser.
  Object.defineProperty(request, 'headers', {
    value: {
      get(name: string) {
        if (name.toLowerCase() === 'origin') return origin;
        if (name.toLowerCase() === 'content-type') return 'application/json';
        return null;
      },
    },
  });
  return request;
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

const executableAuthClient = authClientSource.replace(
  /import\s*\{[\s\S]*?\}\s*from\s*['"]\/js\/vendor\/netlify-identity\.js['"];?\s*/,
  ''
);
const executablePortalClient = portalClientSource.replace(
  /import\s*\{\s*logout\s*\}\s*from\s*['"]\/js\/vendor\/netlify-identity\.js['"];?\s*/,
  ''
);

function authDependencies(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  return {
    getUser: vi.fn(async () => null),
    handleAuthCallback: vi.fn(async () => null),
    login: vi.fn(async () => undefined),
    requestPasswordRecovery: vi.fn(async () => undefined),
    signup: vi.fn(async () => undefined),
    updateUser: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function runAuthClient(deps: ReturnType<typeof authDependencies>) {
  const execute = new AsyncFunction(
    'getUser',
    'handleAuthCallback',
    'login',
    'requestPasswordRecovery',
    'signup',
    'updateUser',
    executableAuthClient
  );
  await execute(
    deps.getUser,
    deps.handleAuthCallback,
    deps.login,
    deps.requestPasswordRecovery,
    deps.signup,
    deps.updateUser
  );
}

function loginMarkup() {
  document.body.innerHTML = `
    <p id="accountStatus"></p>
    <form id="loginForm">
      <input id="loginEmail" type="email">
      <input id="loginPassword" type="password">
      <button type="submit">Sign In</button>
    </form>`;
}

function registerMarkup() {
  document.body.innerHTML = `
    <p id="accountStatus"></p>
    <form id="registerForm">
      <input id="registerEmail" type="email">
      <input id="registerName">
      <input id="registerPhone">
      <input id="registerOrganization">
      <textarea id="registerReason"></textarea>
      <input id="registerPassword" type="password">
      <input id="registerPasswordConfirm" type="password">
      <button type="submit">Create Account</button>
    </form>`;
}

function input(id: string) {
  return document.getElementById(id) as HTMLInputElement;
}

async function submit(id: string) {
  document
    .getElementById(id)!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}

async function flush() {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

function portalMarkup() {
  document.body.innerHTML = `
    <button id="portalMenuToggle" aria-expanded="false"></button>
    <div id="portalBackdrop"></div>
    <aside id="portalSidebar"></aside>
    <button id="portalLogout"></button>
    <div id="portalLoading">Loading...</div>
    <div id="portalShell" class="hidden"></div>
    <span id="headerMemberName"></span>
    <span id="sidebarMemberName"></span>
    <span id="sidebarMemberEmail"></span>
    <span id="dashboardMemberName"></span>
    <span id="accountStatusPill"></span>
    <h1 id="accountStatusHeading"></h1>
    <p id="accountStatusMessage"></p>
    <p id="memberToolsMessage"></p>
    <p id="accountDecisionMessage"></p>
    <nav id="coordinatorNavigation" class="hidden"></nav>
    <section id="coordinatorDashboardCard" class="hidden"></section>
    <span id="pendingBadge"></span>
    <span id="pendingDashboardCount"></span>
    <span id="pendingDashboardPlural"></span>
    <p id="accountReviewStatus"></p>
    <div id="portalAccountList"></div>
    <form id="portalProfileForm">
      <input id="profileName"><input id="profileEmail"><input id="profilePhone">
      <input id="profileOrganization"><textarea id="profileReason"></textarea>
      <button type="submit">Save Profile</button>
    </form>
    <p id="profileStatus"></p>
    <button data-portal-view="dashboard"></button>
    <button data-portal-view="profile"></button>
    <button data-portal-view="access"></button>
    <main class="portal-main" tabindex="-1">
      <section class="portal-view" data-view="dashboard"></section>
      <section class="portal-view" data-view="profile"></section>
      <section class="portal-view" data-view="access"></section>
    </main>`;
}

async function runPortalClient() {
  const execute = new AsyncFunction('logout', executablePortalClient);
  await execute(vi.fn(async () => undefined));
  await flush();
}

function publicProfileForUi(
  status: AccessStatus,
  role: PortalRole = 'member'
): Record<string, unknown> {
  return {
    id: profileId(999),
    email: MEMBER.email,
    display_name: 'Volunteer Person',
    phone: null,
    organization: null,
    request_reason: null,
    status,
    role,
    decision_message: status === 'suspended' ? 'Please contact the coordinator.' : null,
    reviewed_at: null,
    created_at: NOW,
    updated_at: NOW,
  };
}

function mockPortalFetch(profile: Record<string, unknown>, status = 200) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/admin/user-profiles') {
      return new Response(JSON.stringify({ profiles: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify(status === 200 ? { profile } : { error: 'Request failed.' }),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  state.identityUser = null;
  state.dbCalls.length = 0;
  state.profiles.clear();
  state.nextProfile = 1;
  state.dbFailure = null;
  state.provisionGate = null;
  state.getUser.mockReset();
  state.getDatabase.mockReset();
  state.getUser.mockImplementation(async () => state.identityUser);
  state.db = { sql: vi.fn(sqlHandler) };
  state.getDatabase.mockImplementation(() => state.db);

  delete process.env.RESEND_API_KEY;
  delete process.env.NOTIFY_EMAIL;
  window.history.replaceState(null, '', '/login/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.NOTIFY_EMAIL;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Phase A: AuthClient sign in / register ──────────────────────────────────

describe('Phase A: AuthClient sign in or register', () => {
  it('✅ A1 signs in with a trimmed email and opens the portal', async () => {
    loginMarkup();
    const deps = authDependencies();
    await runAuthClient(deps);
    input('loginEmail').value = '  volunteer@example.com  ';
    input('loginPassword').value = 'correct horse battery staple';

    await submit('loginForm');

    expect(deps.login).toHaveBeenCalledWith(
      'volunteer@example.com',
      'correct horse battery staple'
    );
    expect(window.location.pathname).toBe('/portal/');
  });

  it('✅ A1b returns a coordinator to the roster after centralized sign-in', async () => {
    window.history.replaceState(null, '', '/login/?next=%2Froster%2F');
    loginMarkup();
    const deps = authDependencies();
    await runAuthClient(deps);
    input('loginEmail').value = 'coordinator@example.com';
    input('loginPassword').value = 'correct horse battery staple';

    await submit('loginForm');

    expect(window.location.pathname).toBe('/roster/');
  });

  it('🔒 A1c rejects external or unrecognized post-login destinations', async () => {
    for (const next of ['https://attacker.example/', '//attacker.example/', '/admin/']) {
      window.history.replaceState(null, '', '/login/?next=' + encodeURIComponent(next));
      loginMarkup();
      const deps = authDependencies();
      await runAuthClient(deps);
      input('loginEmail').value = 'coordinator@example.com';
      input('loginPassword').value = 'correct horse battery staple';

      await submit('loginForm');

      expect(window.location.pathname).toBe('/portal/');
    }
  });

  it('❌ A2 keeps invalid credentials on the public login page with a safe message', async () => {
    loginMarkup();
    const deps = authDependencies({
      login: vi.fn(async () => {
        throw new Error('Invalid login credentials');
      }),
    });
    await runAuthClient(deps);
    input('loginEmail').value = 'volunteer@example.com';
    input('loginPassword').value = 'wrong password';

    await submit('loginForm');

    expect(document.getElementById('accountStatus')!.textContent).toBe(
      'The email address or password is incorrect.'
    );
    expect(window.location.pathname).toBe('/login/');
    expect(document.querySelector<HTMLButtonElement>('#loginForm button')!.disabled).toBe(false);
  });

  it('❌ A3 rejects mismatched registration passwords before calling Identity', async () => {
    registerMarkup();
    const deps = authDependencies();
    await runAuthClient(deps);
    input('registerPassword').value = 'long-password-one';
    input('registerPasswordConfirm').value = 'long-password-two';

    await submit('registerForm');

    expect(deps.signup).not.toHaveBeenCalled();
    expect(document.getElementById('accountStatus')!.textContent).toBe(
      'The two passwords do not match.'
    );
  });

  it('✅ A4 creates an unconfirmed account with trimmed profile metadata and waits for email confirmation', async () => {
    registerMarkup();
    const deps = authDependencies();
    await runAuthClient(deps);
    input('registerEmail').value = '  new@example.com  ';
    input('registerName').value = '  New Volunteer  ';
    input('registerPhone').value = '  555-0188  ';
    input('registerOrganization').value = '  Hope Church  ';
    input('registerReason').value = '  I want to help rebuild.  ';
    input('registerPassword').value = 'long-enough-password';
    input('registerPasswordConfirm').value = 'long-enough-password';

    await submit('registerForm');

    expect(deps.signup).toHaveBeenCalledWith('new@example.com', 'long-enough-password', {
      full_name: 'New Volunteer',
      phone: '555-0188',
      organization: 'Hope Church',
      request_reason: 'I want to help rebuild.',
    });
    expect(document.getElementById('accountStatus')!.textContent).toContain(
      'Open the confirmation email'
    );
    expect(document.querySelector<HTMLButtonElement>('#registerForm button')!.disabled).toBe(true);
    expect(window.location.pathname).toBe('/login/');
  });

  it('✅ A5 sends an auto-confirmed registration directly to the portal', async () => {
    registerMarkup();
    const deps = authDependencies({
      getUser: vi.fn(async () => MEMBER),
    });
    await runAuthClient(deps);
    input('registerEmail').value = MEMBER.email!;
    input('registerName').value = 'Volunteer Person';
    input('registerPassword').value = 'long-enough-password';
    input('registerPasswordConfirm').value = 'long-enough-password';

    await submit('registerForm');

    expect(deps.signup).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/portal/');
  });

  it('❌ A6 explains a duplicate registration without exposing provider details', async () => {
    registerMarkup();
    const deps = authDependencies({
      signup: vi.fn(async () => {
        throw new Error('User already registered');
      }),
    });
    await runAuthClient(deps);
    input('registerEmail').value = MEMBER.email!;
    input('registerPassword').value = 'long-enough-password';
    input('registerPasswordConfirm').value = 'long-enough-password';

    await submit('registerForm');

    expect(document.getElementById('accountStatus')!.textContent).toContain(
      'An account already exists'
    );
    expect(window.location.pathname).toBe('/login/');
  });

  it('⚠️ A7 reports an unavailable Identity service and permits a retry', async () => {
    loginMarkup();
    const deps = authDependencies({
      login: vi.fn(async () => {
        throw new Error('Failed to fetch');
      }),
    });
    await runAuthClient(deps);
    input('loginEmail').value = MEMBER.email!;
    input('loginPassword').value = 'long-enough-password';

    await submit('loginForm');

    expect(document.getElementById('accountStatus')!.textContent).toContain(
      'account service is not available'
    );
    expect(document.querySelector<HTMLButtonElement>('#loginForm button')!.disabled).toBe(false);
  });
});

// ─── Phase B: Identity session → PortalAPI → user_profiles ──────────────────

describe('Phase B: authenticated session and profile provisioning', () => {
  it('❌ B1 returns 401 for a missing or expired Identity session before database access', async () => {
    state.identityUser = null;

    const response = await portalProfileHandler(portalRequest());

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(state.getDatabase).not.toHaveBeenCalled();
    expect(state.dbCalls).toHaveLength(0);
  });

  it('✅ B2 provisions a first-time member as pending and returns a no-store profile', async () => {
    state.identityUser = MEMBER;

    const response = await portalProfileHandler(portalRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body.profile).toMatchObject({
      email: MEMBER.email,
      display_name: 'Volunteer Person',
      status: 'pending',
      role: 'member',
    });
    expect(state.profiles.size).toBe(1);
  });

  it('✅ B3 loads the same active profile on repeat login without resetting approval', async () => {
    const existing = seedProfile({ status: 'active', role: 'member' });
    state.identityUser = MEMBER;

    const first = await getOrCreateProfile(MEMBER, state.db!);
    const second = await getOrCreateProfile(MEMBER, state.db!);

    expect(first.id).toBe(existing.id);
    expect(second.id).toBe(existing.id);
    expect(second.status).toBe('active');
    expect(state.profiles.size).toBe(1);
  });

  it('⚠️ B4 makes simultaneous first logins idempotent through the profile upsert', async () => {
    const gate = deferred();
    state.provisionGate = gate.promise;

    const first = getOrCreateProfile(MEMBER, state.db!);
    const second = getOrCreateProfile(MEMBER, state.db!);
    gate.release();
    const [a, b] = await Promise.all([first, second]);

    expect(a.id).toBe(b.id);
    expect(state.profiles.size).toBe(1);
    expect(state.dbCalls.filter((call) => /ON CONFLICT/.test(call.text))).toHaveLength(2);
  });

  it('🔒 B5 ignores a client-supplied coordinator claim and trusts only the Identity user', async () => {
    state.identityUser = MEMBER;

    const response = await portalProfileHandler(
      portalRequest('GET', { 'X-Portal-Role': 'coordinator', 'X-Portal-Status': 'active' })
    );
    const body = await response.json();

    expect(body.profile).toMatchObject({ role: 'member', status: 'pending' });
  });

  it('✅ B6 provisions an Identity coordinator as active with coordinator access', async () => {
    state.identityUser = COORDINATOR;

    const response = await portalProfileHandler(portalRequest());
    const body = await response.json();

    expect(body.profile).toMatchObject({ role: 'coordinator', status: 'active' });
  });

  it('🔒 B7 suspends and demotes a former coordinator when the Identity role is removed', async () => {
    seedProfile({ role: 'coordinator', status: 'active' });
    state.identityUser = MEMBER;

    const response = await portalProfileHandler(portalRequest());
    const body = await response.json();

    expect(body.profile).toMatchObject({ role: 'member', status: 'suspended' });
  });

  it('❌ B8 rejects an authenticated Identity account with no email before issuing SQL', async () => {
    const invalidUser = { id: 'identity-no-email' };

    await expect(getOrCreateProfile(invalidUser, state.db!)).rejects.toThrow('no email address');
    expect(state.dbCalls).toHaveLength(0);
  });

  it('🔒 B9 parameterizes hostile profile metadata instead of placing it in SQL text', async () => {
    const maliciousName = "Robert'); UPDATE user_profiles SET role='coordinator'; --";
    const user = {
      ...MEMBER,
      userMetadata: { ...MEMBER.userMetadata, full_name: maliciousName },
    };

    const profile = await getOrCreateProfile(user, state.db!);
    const insert = state.dbCalls.find((call) => /INSERT INTO user_profiles/.test(call.text))!;

    expect(profile.display_name).toBe(maliciousName);
    expect(insert.values).toContain(maliciousName);
    expect(insert.text).not.toContain(maliciousName);
    expect(profile.role).toBe('member');
    expect(profile.status).toBe('pending');
  });

  it('🔒 B10 blocks a suspended profile when an endpoint requires active access', async () => {
    seedProfile({ status: 'suspended', role: 'member' });
    state.identityUser = MEMBER;

    const session = await getPortalSession({ activeOnly: true });

    expect(session.response?.status).toBe(403);
    expect(await session.response?.json()).toEqual({
      error: 'This account does not currently have access.',
    });
  });

  it('🔒 B11 blocks an active member when an endpoint requires the coordinator role', async () => {
    seedProfile({ status: 'active', role: 'member' });
    state.identityUser = MEMBER;

    const session = await getPortalSession({ activeOnly: true, role: 'coordinator' });

    expect(session.response?.status).toBe(403);
    expect(await session.response?.json()).toEqual({
      error: 'You do not have permission to use this area.',
    });
  });

  it('✅ B12 allows an active coordinator through both authorization gates', async () => {
    seedProfile({ status: 'active', role: 'coordinator' }, COORDINATOR.id);
    state.identityUser = COORDINATOR;

    const session = await getPortalSession({ activeOnly: true, role: 'coordinator' });

    expect(session.response).toBeUndefined();
    expect(session.profile).toMatchObject({ status: 'active', role: 'coordinator' });
  });

  it('✅ B13 permits a pending member to update their own profile', async () => {
    seedProfile({ status: 'pending', role: 'member' });
    state.identityUser = MEMBER;

    const response = await portalProfileHandler(
      portalPatchRequest({
        display_name: '  Updated Volunteer  ',
        phone: ' 555-0199 ',
        organization: ' Recovery Team ',
        request_reason: ' Available on weekends. ',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profile).toMatchObject({
      display_name: 'Updated Volunteer',
      phone: '555-0199',
      organization: 'Recovery Team',
      request_reason: 'Available on weekends.',
      status: 'pending',
    });
    expect(
      state.dbCalls.filter((call) => /UPDATE user_profiles SET display_name/.test(call.text))
    ).toHaveLength(1);
  });

  it('✅ B14 permits an active member to update their own profile without changing access', async () => {
    seedProfile({ status: 'active', role: 'member' });
    state.identityUser = MEMBER;

    const response = await portalProfileHandler(
      portalPatchRequest({ display_name: 'Active Volunteer', phone: '555-0177' })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profile).toMatchObject({
      display_name: 'Active Volunteer',
      phone: '555-0177',
      status: 'active',
      role: 'member',
    });
    expect(
      state.dbCalls.filter((call) => /UPDATE user_profiles SET display_name/.test(call.text))
    ).toHaveLength(1);
  });

  it('🔒 B15 rejects a denied member profile update before issuing an UPDATE', async () => {
    seedProfile({ status: 'denied', role: 'member' });
    state.identityUser = MEMBER;

    const response = await portalProfileHandler(
      portalPatchRequest({ display_name: 'Denied Volunteer' })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'This account cannot be edited.' });
    expect(
      state.dbCalls.filter((call) => /UPDATE user_profiles SET display_name/.test(call.text))
    ).toHaveLength(0);
  });

  it('🔒 B16 rejects a suspended member profile update before issuing an UPDATE', async () => {
    seedProfile({ status: 'suspended', role: 'member' });
    state.identityUser = MEMBER;

    const response = await portalProfileHandler(
      portalPatchRequest({ display_name: 'Suspended Volunteer' })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'This account cannot be edited.' });
    expect(
      state.dbCalls.filter((call) => /UPDATE user_profiles SET display_name/.test(call.text))
    ).toHaveLength(0);
  });

  it('🔒 B17 rejects a cross-origin profile update before issuing an UPDATE', async () => {
    seedProfile({ status: 'pending', role: 'member' });
    state.identityUser = MEMBER;

    const response = await portalProfileHandler(
      portalPatchRequest({ display_name: 'Cross-Origin Attempt' }, 'https://attacker.example')
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Request origin is not allowed.' });
    expect(
      state.dbCalls.filter((call) => /UPDATE user_profiles SET display_name/.test(call.text))
    ).toHaveLength(0);
  });
});

// ─── Phase C: AuthClient displays profile/access state ───────────────────────

describe('Phase C: portal display and access status', () => {
  it('✅ C1 shows a pending volunteer the review-waiting state and withholds private tools', async () => {
    portalMarkup();
    mockPortalFetch(publicProfileForUi('pending'));

    await runPortalClient();

    expect(document.getElementById('accountStatusHeading')!.textContent).toContain(
      'waiting for review'
    );
    expect(document.getElementById('memberToolsMessage')!.textContent).toContain(
      'after your account is approved'
    );
    expect(document.getElementById('coordinatorNavigation')!.classList).toContain('hidden');
  });

  it('✅ C2 shows an active volunteer the approved portal state', async () => {
    portalMarkup();
    mockPortalFetch(publicProfileForUi('active'));

    await runPortalClient();

    expect(document.getElementById('accountStatusPill')!.textContent).toBe('Approved');
    expect(document.getElementById('memberToolsMessage')!.textContent).toContain(
      'Additional volunteer tools'
    );
  });

  it('✅ C3 shows a denied volunteer the not-approved state without coordinator controls', async () => {
    portalMarkup();
    mockPortalFetch(publicProfileForUi('denied'));

    await runPortalClient();

    expect(document.getElementById('accountStatusPill')!.textContent).toBe('Not approved');
    expect(document.getElementById('coordinatorNavigation')!.classList).toContain('hidden');
  });

  it('🔒 C4 shows a suspended volunteer the suspension message and withholds private tools', async () => {
    portalMarkup();
    mockPortalFetch(publicProfileForUi('suspended'));

    await runPortalClient();

    expect(document.getElementById('accountStatusPill')!.textContent).toBe('Access suspended');
    expect(document.getElementById('memberToolsMessage')!.textContent).toContain(
      'after your account is approved'
    );
    expect(document.getElementById('accountDecisionMessage')!.textContent).toContain(
      'contact the coordinator'
    );
  });

  it('✅ C5 reveals account-review navigation only for an active coordinator', async () => {
    portalMarkup();
    const fetchMock = mockPortalFetch(publicProfileForUi('active', 'coordinator'));

    await runPortalClient();

    expect(document.getElementById('coordinatorNavigation')!.classList).not.toContain('hidden');
    expect(document.getElementById('coordinatorDashboardCard')!.classList).not.toContain('hidden');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/user-profiles', expect.any(Object));
  });

  it('🔒 C6 refuses a member-forced #access route and opens the dashboard instead', async () => {
    window.history.replaceState(null, '', '/portal/#access');
    portalMarkup();
    mockPortalFetch(publicProfileForUi('active', 'member'));

    await runPortalClient();

    expect(document.querySelector<HTMLElement>('[data-view="dashboard"]')!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-view="access"]')!.hidden).toBe(true);
    expect(window.location.hash).toBe('');
  });

  it('❌ C7 redirects a 401 response to login without revealing the portal shell', async () => {
    window.history.replaceState(null, '', '/portal/');
    portalMarkup();
    mockPortalFetch({}, 401);

    await runPortalClient();

    expect(window.location.pathname).toBe('/login/');
    expect(document.getElementById('portalShell')!.classList).toContain('hidden');
  });

  it('⚠️ C8 turns a PortalAPI failure into a generic retry message rather than false access', async () => {
    window.history.replaceState(null, '', '/portal/');
    portalMarkup();
    mockPortalFetch({}, 500);

    await runPortalClient();

    expect(document.getElementById('portalLoading')!.textContent).toContain(
      'portal could not load'
    );
    expect(document.getElementById('portalShell')!.classList).toContain('hidden');
  });

  it('❌ C9 fails closed when the PortalAPI response has no profile object', async () => {
    window.history.replaceState(null, '', '/portal/');
    portalMarkup();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ profile: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    await runPortalClient();

    expect(document.getElementById('portalLoading')!.textContent).toContain(
      'portal could not load'
    );
    expect(document.getElementById('portalShell')!.classList).toContain('hidden');
  });
});

// ─── Phase D: lifecycle, isolation, and side effects ─────────────────────────

describe('Phase D: account lifecycle and cross-cutting safeguards', () => {
  it('✅ D1 pre-creates a pending profile after confirmed signup and assigns the pending Identity label', async () => {
    const result = await identityHandler.userSignup({ user: MEMBER });

    expect(state.profiles.get(MEMBER.id)).toMatchObject({
      email: MEMBER.email,
      status: 'pending',
      role: 'member',
    });
    expect(result?.user.appMetadata?.roles).toEqual(['pending']);
  });

  it('⚠️ D2 does not block Identity signup when profile pre-creation temporarily fails', async () => {
    state.dbFailure = new Error('database offline');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await identityHandler.userSignup({ user: MEMBER });

    expect(result?.user.appMetadata?.roles).toEqual(['pending']);
    expect(errorSpy).toHaveBeenCalledWith(
      'Could not pre-create portal profile at signup:',
      expect.any(Error)
    );
    expect(state.profiles.size).toBe(0);
  });

  it('🔒 D3 marks the database profile suspended when the Identity account is deleted', async () => {
    seedProfile({ status: 'active' });

    await identityHandler.userDeleted({ user: MEMBER });

    expect(state.profiles.get(MEMBER.id)).toMatchObject({
      status: 'suspended',
      identity_deleted_at: NOW,
    });
  });

  it('🔒 D4 isolates profiles by the verified Identity subject across consecutive sessions', async () => {
    const other: IdentityUser = {
      id: 'identity-other',
      email: 'other@example.com',
      userMetadata: { full_name: 'Other Volunteer' },
    };
    seedProfile({ status: 'active', email: MEMBER.email! }, MEMBER.id);
    seedProfile(
      { status: 'denied', email: other.email!, display_name: 'Other Volunteer' },
      other.id
    );

    state.identityUser = MEMBER;
    const memberResponse = await portalProfileHandler(portalRequest());
    state.identityUser = other;
    const otherResponse = await portalProfileHandler(portalRequest());

    expect((await memberResponse.json()).profile).toMatchObject({
      email: MEMBER.email,
      status: 'active',
    });
    expect((await otherResponse.json()).profile).toMatchObject({
      email: other.email,
      status: 'denied',
    });
  });

  it('⚠️ D5 leaves no partial profile when the first-login database upsert fails', async () => {
    state.dbFailure = new Error('database offline');

    await expect(getOrCreateProfile(MEMBER, state.db!)).rejects.toThrow('database offline');
    expect(state.profiles.size).toBe(0);
  });

  it('🔒 D6 keeps filesystem, subprocess, stream, and photo/blob systems outside this flow', () => {
    const source = `${portalAuthSource}\n${portalProfileSource}`;

    expect(source).not.toMatch(/node:fs|child_process|node:stream|@netlify\/blobs|getStore\s*\(/);
    expect(source).not.toMatch(/field_note_photos|field-photos|BUILD_HOOK_URL/);
  });

  it('⚠️ D7 aborts a stalled signup notification without rejecting Identity signup', async () => {
    vi.useFakeTimers();
    process.env.RESEND_API_KEY = 'resend-test-key';
    process.env.NOTIFY_EMAIL = 'coordinator@example.com';
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init: RequestInit = {}) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(new DOMException('The notification timed out.', 'AbortError')),
          { once: true }
        );
      });
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchMock);

    const signup = identityHandler.userSignup({ user: MEMBER });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(NOTIFY_TIMEOUT_MS);
    const result = await signup;

    expect(signal?.aborted).toBe(true);
    expect(result?.user.appMetadata?.roles).toEqual(['pending']);
    expect(errorSpy).toHaveBeenCalledWith(
      'Notification email timed out:',
      expect.objectContaining({ name: 'AbortError' })
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('✅ D8 clears the notification timeout after a successful signup email', async () => {
    vi.useFakeTimers();
    process.env.RESEND_API_KEY = 'resend-test-key';
    process.env.NOTIFY_EMAIL = 'coordinator@example.com';
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit = {}) => {
      signal = init.signal as AbortSignal;
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await identityHandler.userSignup({ user: MEMBER });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    expect(result?.user.appMetadata?.roles).toEqual(['pending']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
