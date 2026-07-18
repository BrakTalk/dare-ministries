// POST /api/admin/login and /api/admin/logout — admin session management.
import { json, readBody } from './lib/helpers.mjs';
import {
  checkPassword,
  createSessionCookie,
  clearSessionCookie,
  isAuthenticated,
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
    // Lets the console check whether an existing session is still valid.
    return json({ authenticated: isAuthenticated(req) });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await readBody(req);
  if (!body || !checkPassword(body.password)) {
    // Blunt the pace of guessing without needing shared state.
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: 'Incorrect password' }, 401);
  }

  return json({ ok: true }, 200, { 'Set-Cookie': createSessionCookie() });
};
