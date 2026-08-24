import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getPortalSession: vi.fn(),
}));

vi.mock('../lib/portal-auth.mjs', () => ({
  getPortalSession: state.getPortalSession,
}));

import adminSessionHandler from '../admin-session.mjs';
import { createSessionCookie, requireAuth } from '../lib/auth.mjs';

const savedEnv: Record<string, string | undefined> = {};

function activeCoordinatorSession() {
  return {
    user: { id: 'identity-coordinator' },
    profile: { status: 'active', role: 'coordinator' },
    db: {},
  };
}

function deniedPortalSession(status = 403) {
  return {
    response: new Response(
      JSON.stringify({ error: 'This account does not currently have access.' }),
      {
        status,
        headers: { 'Content-Type': 'application/json' },
      }
    ),
  };
}

function adminCookie() {
  return createSessionCookie().split(';', 1)[0];
}

function adminRequest(
  path: '/api/admin/login' | '/api/admin/volunteers',
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

beforeEach(() => {
  savedEnv.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  savedEnv.SESSION_SECRET = process.env.SESSION_SECRET;
  process.env.ADMIN_PASSWORD = 'shared-admin-password';
  process.env.SESSION_SECRET = 'test-session-secret';
  state.getPortalSession.mockReset();
  state.getPortalSession.mockResolvedValue(activeCoordinatorSession());
});

afterEach(() => {
  for (const key of ['ADMIN_PASSWORD', 'SESSION_SECRET'] as const) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.restoreAllMocks();
});

describe('Roster Console active-coordinator gate', () => {
  it('rejects a request without the shared admin session before querying the portal profile', async () => {
    const response = await requireAuth(adminRequest('/api/admin/volunteers'));

    expect(response?.status).toBe(401);
    expect(state.getPortalSession).not.toHaveBeenCalled();
  });

  it('accepts a shared admin session only when the portal profile is an active coordinator', async () => {
    const response = await requireAuth(
      adminRequest('/api/admin/volunteers', { cookie: adminCookie() })
    );

    expect(response).toBeNull();
    expect(state.getPortalSession).toHaveBeenCalledWith({
      activeOnly: true,
      role: 'coordinator',
    });
  });

  it('rejects a valid shared admin session when the portal profile is pending or suspended', async () => {
    state.getPortalSession.mockResolvedValue(deniedPortalSession());

    const response = await requireAuth(
      adminRequest('/api/admin/volunteers', { cookie: adminCookie() })
    );

    expect(response?.status).toBe(403);
  });

  it('issues the shared admin cookie only to an active coordinator', async () => {
    const response = await adminSessionHandler(
      adminRequest('/api/admin/login', {
        method: 'POST',
        body: { password: 'shared-admin-password' },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('dare_admin_session=');
  });

  it('does not issue the shared admin cookie to an inactive profile', async () => {
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

  it('reports an existing shared session as logged out after coordinator access is revoked', async () => {
    state.getPortalSession.mockResolvedValue(deniedPortalSession());

    const response = await adminSessionHandler(
      adminRequest('/api/admin/login', { cookie: adminCookie() })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: false });
  });
});
