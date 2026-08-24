// POST /api/admin/login and /api/admin/logout — admin session management.
import { json, readBody } from './lib/helpers.mjs';
import {
  checkPassword,
  createSessionCookie,
  clearSessionCookie,
  requireActiveCoordinator,
  requireAuth,
} from './lib/auth.mjs';

export const config = { path: ['/api/admin/login', '/api/admin/logout'] };

export default async (req) => {
  const url = new URL(req.url);

  if (url.pathname === '/api/admin/logout') {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  }

  // /api/admin/login
  if (req.method === 'GET') {
    // A shared-password cookie is only valid while the current Identity user
    // remains an active coordinator in the portal database.
    return json({ authenticated: !(await requireAuth(req)) });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await readBody(req);
  if (!body || !checkPassword(body.password)) {
    // Blunt the pace of guessing without needing shared state.
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: 'Incorrect password' }, 401);
  }

  const unauthorized = await requireActiveCoordinator();
  if (unauthorized) return unauthorized;

  return json({ ok: true }, 200, { 'Set-Cookie': createSessionCookie() });
};
