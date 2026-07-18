// Session auth for the roster admin console.
// Login checks ADMIN_PASSWORD; sessions are HMAC-signed tokens (SESSION_SECRET)
// carried in an HttpOnly cookie. No user database — this is a single shared
// admin credential for DARE leadership.

import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'dare_admin_session';
const SESSION_DAYS = 7;

function sign(payload) {
  return createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function checkPassword(password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof password !== 'string') return false;
  return safeEqual(password, expected);
}

export function createSessionCookie() {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const token = payload + '.' + sign(payload);
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function isAuthenticated(req) {
  if (!process.env.SESSION_SECRET) return false;

  const cookies = req.headers.get('cookie') || '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;

  const [payload, signature] = match[1].split('.');
  if (!payload || !signature) return false;
  if (!safeEqual(signature, sign(payload))) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}

// Returns a 401 Response when the request has no valid session, else null.
export function requireAuth(req) {
  if (isAuthenticated(req)) return null;
  return new Response(JSON.stringify({ error: 'Not authenticated' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
