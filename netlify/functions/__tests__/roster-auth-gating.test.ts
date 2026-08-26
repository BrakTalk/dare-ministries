import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface PortalProfile {
  display_name?: string;
  email?: string;
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
  requireSameOrigin: vi.fn(),
  getDatabase: vi.fn(),
  sql: vi.fn(),
  getStore: vi.fn(),
}));

vi.mock('../lib/portal-auth.mjs', () => ({
  getPortalSession: state.getPortalSession,
  requireSameOrigin: state.requireSameOrigin,
}));

vi.mock('@netlify/database', () => ({
  getDatabase: state.getDatabase,
}));

vi.mock('@netlify/blobs', () => ({
  getStore: state.getStore,
}));

import contactsHandler from '../admin-contacts.mjs';
import fieldPhotoInboxHandler from '../admin-field-photo-inbox.mjs';
import fieldNotePhotosHandler from '../admin-field-note-photos.mjs';
import fieldNotesHandler from '../admin-field-notes.mjs';
import impactStatsHandler from '../admin-impact-stats.mjs';
import adminSessionHandler from '../admin-session.mjs';
import volunteersHandler from '../admin-volunteers.mjs';
import { getCoordinatorSession, requireAuth } from '../lib/auth.mjs';

const protectedHandlers: ProtectedHandler[] = [
  { name: 'volunteers', path: '/api/admin/volunteers', handler: volunteersHandler },
  { name: 'contacts', path: '/api/admin/contacts', handler: contactsHandler },
  { name: 'impact statistics', path: '/api/admin/impact-stats', handler: impactStatsHandler },
  { name: 'field notes', path: '/api/admin/field-notes', handler: fieldNotesHandler },
  {
    name: 'field photo inbox',
    path: '/api/admin/field-photo-inbox',
    handler: fieldPhotoInboxHandler,
  },
  {
    name: 'field-note photos',
    path: '/api/admin/field-note-photos',
    handler: fieldNotePhotosHandler,
  },
];

function activeCoordinatorSession(): PortalSessionResult {
  return {
    user: { id: 'identity-coordinator' },
    profile: {
      display_name: 'Casey Coordinator',
      email: 'casey@example.com',
      status: 'active',
      role: 'coordinator',
    },
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

function originDenied() {
  return new Response(JSON.stringify({ error: 'Request origin is not allowed.' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function adminRequest(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}
) {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.cookie) headers.set('Cookie', options.cookie);
  if (options.origin) headers.set('Origin', options.origin);
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
  state.getPortalSession.mockReset();
  state.getPortalSession.mockResolvedValue(activeCoordinatorSession());
  state.requireSameOrigin.mockReset();
  state.requireSameOrigin.mockImplementation((req: Request) =>
    req.headers.get('origin') === new URL(req.url).origin ? null : originDenied()
  );
  state.sql.mockReset();
  state.sql.mockResolvedValue([]);
  state.getDatabase.mockReset();
  state.getDatabase.mockReturnValue({ sql: state.sql });
  state.getStore.mockReset();
  state.getStore.mockReturnValue({});
});

describe('Phase: Coordinator authorization contract', () => {
  it('✅ PTA-001 accepts an active coordinator without a legacy admin cookie', async () => {
    const response = await requireAuth(adminRequest('/api/admin/volunteers'));

    expect(response).toBeNull();
    expect(state.getPortalSession).toHaveBeenCalledWith({
      activeOnly: true,
      role: 'coordinator',
    });
    expect(state.requireSameOrigin).not.toHaveBeenCalled();
  });

  it('❌ PTA-002 preserves the portal 401 when the Identity session is missing', async () => {
    const denied = deniedPortalSession(401, 'Please sign in to continue.');
    state.getPortalSession.mockResolvedValue(denied);

    const response = await requireAuth(adminRequest('/api/admin/volunteers'));

    expect(response).toBe(denied.response);
    expect(response?.status).toBe(401);
    expect(response?.headers.get('cache-control')).toBe('no-store');
  });

  it('🔒 PTA-003 preserves a 403 for an inactive or non-coordinator profile', async () => {
    const denied = deniedPortalSession();
    state.getPortalSession.mockResolvedValue(denied);

    const response = await requireAuth(adminRequest('/api/admin/volunteers'));

    expect(response).toBe(denied.response);
    expect(response?.status).toBe(403);
  });

  it('🔒 PTA-004 fails closed when PortalAuth returns a malformed session object', async () => {
    state.getPortalSession.mockResolvedValue({});

    const response = await requireAuth(adminRequest('/api/admin/volunteers'));

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: 'Private tool access could not be verified.',
    });
  });

  it('🔒 PTA-005 gives a denial response precedence over conflicting profile data', async () => {
    const denied = deniedPortalSession();
    state.getPortalSession.mockResolvedValue({
      ...activeCoordinatorSession(),
      response: denied.response,
    });

    const session = await getCoordinatorSession();

    expect(session.response).toBe(denied.response);
    expect(session.profile).toBeUndefined();
  });

  it('❌ PTA-006 propagates Identity/database failures and never grants access', async () => {
    const failure = new Error('Identity or database unavailable');
    state.getPortalSession.mockRejectedValue(failure);

    await expect(requireAuth(adminRequest('/api/admin/volunteers'))).rejects.toBe(failure);
  });
});

describe('Phase: Same-origin mutation protection', () => {
  it('✅ PTA-007 checks the origin after coordinator authorization for mutations', async () => {
    const request = adminRequest('/api/admin/volunteers', {
      method: 'POST',
      origin: 'https://whofixedtheroof.com',
    });

    const response = await requireAuth(request);

    expect(response).toBeNull();
    expect(state.getPortalSession).toHaveBeenCalledTimes(1);
    expect(state.requireSameOrigin).toHaveBeenCalledWith(request);
  });

  it('🔒 PTA-008 rejects a missing or cross-origin mutation before domain access', async () => {
    const requests = [
      adminRequest('/api/admin/volunteers', { method: 'POST', body: { name: 'A' } }),
      adminRequest('/api/admin/volunteers', {
        method: 'POST',
        body: { name: 'A' },
        origin: 'https://attacker.example',
      }),
    ];

    for (const request of requests) {
      const response = await volunteersHandler(request);
      expect(response.status).toBe(403);
    }
    expect(state.getDatabase).not.toHaveBeenCalled();
  });

  it('✅ PTA-009 permits a same-origin mutation to reach its handler', async () => {
    state.sql.mockResolvedValue([{ id: 'volunteer-id' }]);

    const response = await volunteersHandler(
      adminRequest('/api/admin/volunteers', {
        method: 'POST',
        origin: 'https://whofixedtheroof.com',
        body: { name: 'Alex', email: 'alex@example.com' },
      })
    );

    expect(response.status).toBe(201);
    expect(state.getDatabase).toHaveBeenCalledTimes(1);
  });
});

describe('Phase: Coordinator session endpoint', () => {
  it('✅ PTA-010 returns a minimal no-store coordinator profile', async () => {
    const response = await adminSessionHandler(adminRequest('/api/admin/session'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      profile: {
        display_name: 'Casey Coordinator',
        email: 'casey@example.com',
        status: 'active',
        role: 'coordinator',
      },
    });
  });

  it('🔒 PTA-011 returns the exact Identity/profile denial', async () => {
    const denied = deniedPortalSession(401, 'Please sign in to continue.');
    state.getPortalSession.mockResolvedValue(denied);

    const response = await adminSessionHandler(adminRequest('/api/admin/session'));

    expect(response).toBe(denied.response);
  });

  it('❌ PTA-012 rejects non-GET methods without checking Identity', async () => {
    const response = await adminSessionHandler(
      adminRequest('/api/admin/session', { method: 'POST', origin: 'https://whofixedtheroof.com' })
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.getPortalSession).not.toHaveBeenCalled();
  });
});

describe('Phase: Protected handler propagation', () => {
  it('✅ PTA-013 awaits coordinator authorization in every private-tool handler', async () => {
    const responses = await Promise.all(
      protectedHandlers.map(({ path, handler }) => handler(adminRequest(path, { method: 'HEAD' })))
    );

    expect(responses.map((response) => response.status)).toEqual([405, 405, 405, 405, 405, 405]);
    expect(state.getPortalSession).toHaveBeenCalledTimes(protectedHandlers.length);
    expect(state.getDatabase).toHaveBeenCalledTimes(4);
  });

  it('🔒 PTA-014 returns denial before database or blob access in every private tool', async () => {
    state.getPortalSession.mockResolvedValue(deniedPortalSession());

    const responses = await Promise.all(
      protectedHandlers.map(({ path, handler }) => handler(adminRequest(path, { method: 'HEAD' })))
    );

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403, 403]);
    expect(state.getDatabase).not.toHaveBeenCalled();
    expect(state.getStore).not.toHaveBeenCalled();
  });

  it('❌ PTA-015 returns a stable 401 from a protected handler without Identity', async () => {
    state.getPortalSession.mockResolvedValue(
      deniedPortalSession(401, 'Please sign in to continue.')
    );

    const response = await volunteersHandler(adminRequest('/api/admin/volunteers'));

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.getDatabase).not.toHaveBeenCalled();
  });
});

describe('Phase: Revocation, concurrency, and legacy removal', () => {
  it('🔒 PTA-016 revalidates duplicate requests instead of replaying stale authorization', async () => {
    state.getPortalSession
      .mockResolvedValueOnce(activeCoordinatorSession())
      .mockResolvedValueOnce(deniedPortalSession());
    const request = () => adminRequest('/api/admin/volunteers');

    const first = await requireAuth(request());
    const replay = await requireAuth(request());

    expect(first).toBeNull();
    expect(replay?.status).toBe(403);
    expect(state.getPortalSession).toHaveBeenCalledTimes(2);
  });

  it('⚠️ PTA-017 isolates concurrent coordinator authorization outcomes', async () => {
    const active = deferred<PortalSessionResult>();
    const denied = deferred<PortalSessionResult>();
    state.getPortalSession
      .mockImplementationOnce(() => active.promise)
      .mockImplementationOnce(() => denied.promise);

    const first = requireAuth(adminRequest('/api/admin/volunteers'));
    const second = requireAuth(adminRequest('/api/admin/volunteers'));
    denied.resolve(deniedPortalSession());
    active.resolve(activeCoordinatorSession());

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBeNull();
    expect(secondResult?.status).toBe(403);
  });

  it('🔒 PTA-018 removes the shared password, HMAC secret, and legacy cookie contract', () => {
    const authSource = readFileSync(
      resolve(process.cwd(), 'netlify/functions/lib/auth.mjs'),
      'utf8'
    );
    const sessionSource = readFileSync(
      resolve(process.cwd(), 'netlify/functions/admin-session.mjs'),
      'utf8'
    );
    const source = authSource + sessionSource;

    expect(source).not.toContain('ADMIN_PASSWORD');
    expect(source).not.toContain('SESSION_SECRET');
    expect(source).not.toContain('dare_admin_session');
    expect(source).not.toContain('/api/admin/login');
  });
});
