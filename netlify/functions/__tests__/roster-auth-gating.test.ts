import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface PortalProfile {
  status: 'pending' | 'active' | 'denied' | 'suspended';
  role: 'member' | 'coordinator';
}

interface PortalSessionResult {
  response?: Response;
  user?: { id: string };
  profile?: PortalProfile;
  db?: object;
}

interface ProtectedHandler {
  name: string;
  path: string;
  handler: (request: Request) => Promise<Response>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const state = vi.hoisted(() => ({
  getPortalSession: vi.fn(),
  getDatabase: vi.fn(),
  sql: vi.fn(),
  getStore: vi.fn(),
}));

vi.mock('../lib/portal-auth.mjs', () => ({
  getPortalSession: state.getPortalSession,
}));

vi.mock('@netlify/database', () => ({
  getDatabase: state.getDatabase,
}));

vi.mock('@netlify/blobs', () => ({
  getStore: state.getStore,
}));

import contactsHandler from '../admin-contacts.mjs';
import fieldNotePhotosHandler from '../admin-field-note-photos.mjs';
import fieldNotesHandler from '../admin-field-notes.mjs';
import impactStatsHandler from '../admin-impact-stats.mjs';
import adminSessionHandler from '../admin-session.mjs';
import volunteersHandler from '../admin-volunteers.mjs';
import { createSessionCookie, requireAuth } from '../lib/auth.mjs';

const savedEnv: Record<string, string | undefined> = {};
const DAY_MS = 24 * 60 * 60 * 1000;

const protectedHandlers: ProtectedHandler[] = [
  { name: 'volunteers', path: '/api/admin/volunteers', handler: volunteersHandler },
  { name: 'contacts', path: '/api/admin/contacts', handler: contactsHandler },
  { name: 'impact statistics', path: '/api/admin/impact-stats', handler: impactStatsHandler },
  { name: 'field notes', path: '/api/admin/field-notes', handler: fieldNotesHandler },
  {
    name: 'field-note photos',
    path: '/api/admin/field-note-photos',
    handler: fieldNotePhotosHandler,
  },
];

function activeCoordinatorSession(): PortalSessionResult {
  return {
    user: { id: 'identity-coordinator' },
    profile: { status: 'active', role: 'coordinator' },
    db: {},
  };
}

function deniedPortalSession(
  status = 403,
  message = 'This account does not currently have access.'
): PortalSessionResult {
  return {
    response: new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }),
  };
}

function adminCookie() {
  return createSessionCookie().split(';', 1)[0];
}

function adminRequest(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string } = {}
) {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.cookie) headers.set('Cookie', options.cookie);
  return new Request(`https://whofixedtheroof.com${path}`, {
    method: options.method || 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  savedEnv.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  savedEnv.SESSION_SECRET = process.env.SESSION_SECRET;
  process.env.ADMIN_PASSWORD = 'shared-admin-password';
  process.env.SESSION_SECRET = 'test-session-secret';

  state.getPortalSession.mockReset();
  state.getPortalSession.mockResolvedValue(activeCoordinatorSession());
  state.sql.mockReset();
  state.sql.mockResolvedValue([]);
  state.getDatabase.mockReset();
  state.getDatabase.mockReturnValue({ sql: state.sql });
  state.getStore.mockReset();
  state.getStore.mockReturnValue({});
});

afterEach(() => {
  for (const key of ['ADMIN_PASSWORD', 'SESSION_SECRET'] as const) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Phase: Shared admin-session validation', () => {
  it('❌ PTA-001 rejects a missing shared admin session before portal authorization', async () => {
    const response = await requireAuth(adminRequest('/api/admin/volunteers'));

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: 'Not authenticated' });
    expect(response?.headers.get('cache-control')).toBe('no-store');
    expect(state.getPortalSession).not.toHaveBeenCalled();
  });

  it('🔒 PTA-002 rejects a tampered shared admin cookie without querying portal state', async () => {
    const response = await requireAuth(
      adminRequest('/api/admin/volunteers', { cookie: `${adminCookie()}tampered` })
    );

    expect(response?.status).toBe(401);
    expect(state.getPortalSession).not.toHaveBeenCalled();
  });

  it('⚠️ PTA-003 rejects an expired shared admin cookie', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const cookie = adminCookie();
    clock.mockReturnValue(1_000_000 + 8 * DAY_MS);

    const response = await requireAuth(adminRequest('/api/admin/volunteers', { cookie }));

    expect(response?.status).toBe(401);
    expect(state.getPortalSession).not.toHaveBeenCalled();
  });

  it('🔒 PTA-004 rejects every shared cookie when SESSION_SECRET is unavailable', async () => {
    const cookie = adminCookie();
    delete process.env.SESSION_SECRET;

    const response = await requireAuth(adminRequest('/api/admin/volunteers', { cookie }));

    expect(response?.status).toBe(401);
    expect(state.getPortalSession).not.toHaveBeenCalled();
  });

  it('✅ PTA-005 accepts both factors for an active coordinator', async () => {
    const response = await requireAuth(
      adminRequest('/api/admin/volunteers', { cookie: adminCookie() })
    );

    expect(response).toBeNull();
    expect(state.getPortalSession).toHaveBeenCalledWith({
      activeOnly: true,
      role: 'coordinator',
    });
  });
});

describe('Phase: Portal authorization contract', () => {
  it('❌ PTA-006 preserves a portal 401 when the Identity session is missing', async () => {
    const denied = deniedPortalSession(401, 'Please sign in to continue.');
    state.getPortalSession.mockResolvedValue(denied);

    const response = await requireAuth(
      adminRequest('/api/admin/volunteers', { cookie: adminCookie() })
    );

    expect(response).toBe(denied.response);
    expect(response?.status).toBe(401);
  });

  it('🔒 PTA-007 preserves a portal 403 for an inactive or non-coordinator profile', async () => {
    const denied = deniedPortalSession();
    state.getPortalSession.mockResolvedValue(denied);

    const response = await requireAuth(
      adminRequest('/api/admin/volunteers', { cookie: adminCookie() })
    );

    expect(response).toBe(denied.response);
    expect(response?.status).toBe(403);
  });

  it('🔒 PTA-008 fails closed when PortalAuth returns a malformed session object', async () => {
    state.getPortalSession.mockResolvedValue({});

    const response = await requireAuth(
      adminRequest('/api/admin/volunteers', { cookie: adminCookie() })
    );

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: 'Private tool access could not be verified.',
    });
    expect(response?.headers.get('cache-control')).toBe('no-store');
  });

  it('🔒 PTA-009 gives an unauthorized response precedence over conflicting profile data', async () => {
    const denied = deniedPortalSession();
    state.getPortalSession.mockResolvedValue({
      ...activeCoordinatorSession(),
      response: denied.response,
    });

    const response = await requireAuth(
      adminRequest('/api/admin/volunteers', { cookie: adminCookie() })
    );

    expect(response).toBe(denied.response);
  });

  it('❌ PTA-010 propagates a PortalAuth failure and never converts it into authorization', async () => {
    const failure = new Error('Identity or database unavailable');
    state.getPortalSession.mockRejectedValue(failure);

    await expect(
      requireAuth(adminRequest('/api/admin/volunteers', { cookie: adminCookie() }))
    ).rejects.toBe(failure);
  });
});

describe('Phase: Shared admin-session lifecycle', () => {
  it('✅ PTA-011 issues the shared admin cookie only after active-coordinator verification', async () => {
    const response = await adminSessionHandler(
      adminRequest('/api/admin/login', {
        method: 'POST',
        body: { password: 'shared-admin-password' },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('dare_admin_session=');
    expect(state.getPortalSession).toHaveBeenCalledTimes(1);
  });

  it('🔒 PTA-012 rejects and throttles an incorrect shared password without leaking it', async () => {
    vi.useFakeTimers();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const infoLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const responsePromise = adminSessionHandler(
      adminRequest('/api/admin/login', {
        method: 'POST',
        body: { password: 'not-the-shared-password' },
      })
    );

    await vi.advanceTimersByTimeAsync(800);
    const response = await responsePromise;

    expect(response.status).toBe(401);
    expect(state.getPortalSession).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
    expect(infoLog).not.toHaveBeenCalled();
  });

  it('🔒 PTA-013 does not issue a shared cookie to an inactive profile', async () => {
    state.getPortalSession.mockResolvedValue(deniedPortalSession());

    const response = await adminSessionHandler(
      adminRequest('/api/admin/login', {
        method: 'POST',
        body: { password: 'shared-admin-password' },
      })
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('✅ PTA-014 reports an existing session as authenticated while coordinator access remains active', async () => {
    const response = await adminSessionHandler(
      adminRequest('/api/admin/login', { cookie: adminCookie() })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: true });
  });

  it('🔒 PTA-015 reports an existing session as logged out after coordinator access is revoked', async () => {
    state.getPortalSession.mockResolvedValue(deniedPortalSession());

    const response = await adminSessionHandler(
      adminRequest('/api/admin/login', { cookie: adminCookie() })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: false });
  });

  it('✅ PTA-016 clears the shared cookie on logout without requiring a live portal dependency', async () => {
    state.getPortalSession.mockRejectedValue(new Error('Identity unavailable'));

    const response = await adminSessionHandler(
      adminRequest('/api/admin/logout', {
        method: 'POST',
        cookie: adminCookie(),
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(state.getPortalSession).not.toHaveBeenCalled();
  });
});

describe('Phase: Protected handler propagation', () => {
  it('✅ PTA-017 awaits authorization in every private-tool handler before dispatching', async () => {
    const responses = await Promise.all(
      protectedHandlers.map(({ path, handler }) =>
        handler(adminRequest(path, { method: 'HEAD', cookie: adminCookie() }))
      )
    );

    expect(responses.map((response) => response.status)).toEqual([405, 405, 405, 405, 405]);
    expect(state.getPortalSession).toHaveBeenCalledTimes(protectedHandlers.length);
    expect(state.getDatabase).toHaveBeenCalledTimes(4);
  });

  it('🔒 PTA-018 returns denial from every private-tool handler before database or blob access', async () => {
    state.getPortalSession.mockResolvedValue(deniedPortalSession());

    const responses = await Promise.all(
      protectedHandlers.map(({ path, handler }) =>
        handler(adminRequest(path, { method: 'HEAD', cookie: adminCookie() }))
      )
    );

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
    expect(state.getDatabase).not.toHaveBeenCalled();
    expect(state.getStore).not.toHaveBeenCalled();
  });

  it('❌ PTA-019 returns a stable 401 contract from a protected handler with no shared session', async () => {
    const response = await volunteersHandler(adminRequest('/api/admin/volunteers'));

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Not authenticated' });
    expect(state.getPortalSession).not.toHaveBeenCalled();
    expect(state.getDatabase).not.toHaveBeenCalled();
  });
});

describe('Phase: Replay, concurrency, and dependency failure', () => {
  it('🔒 PTA-020 revalidates a duplicate request instead of replaying stale authorization', async () => {
    state.getPortalSession
      .mockResolvedValueOnce(activeCoordinatorSession())
      .mockResolvedValueOnce(deniedPortalSession());
    const request = () => adminRequest('/api/admin/volunteers', { cookie: adminCookie() });

    const first = await requireAuth(request());
    const replay = await requireAuth(request());

    expect(first).toBeNull();
    expect(replay?.status).toBe(403);
    expect(state.getPortalSession).toHaveBeenCalledTimes(2);
  });

  it('⚠️ PTA-021 isolates concurrent authorization outcomes for different requests', async () => {
    const active = deferred<PortalSessionResult>();
    const denied = deferred<PortalSessionResult>();
    state.getPortalSession
      .mockImplementationOnce(() => active.promise)
      .mockImplementationOnce(() => denied.promise);

    const first = requireAuth(adminRequest('/api/admin/volunteers', { cookie: adminCookie() }));
    const second = requireAuth(adminRequest('/api/admin/volunteers', { cookie: adminCookie() }));
    denied.resolve(deniedPortalSession());
    active.resolve(activeCoordinatorSession());

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBeNull();
    expect(secondResult?.status).toBe(403);
  });

  it('❌ PTA-022 does not issue a cookie when PortalAuth fails during login', async () => {
    const failure = new Error('Database unavailable');
    state.getPortalSession.mockRejectedValue(failure);

    await expect(
      adminSessionHandler(
        adminRequest('/api/admin/login', {
          method: 'POST',
          body: { password: 'shared-admin-password' },
        })
      )
    ).rejects.toBe(failure);
  });
});
