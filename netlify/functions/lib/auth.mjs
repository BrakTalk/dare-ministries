// Coordinator authorization for the roster console and its private tools.
// Netlify Identity proves who the visitor is; user_profiles remains the
// authoritative source for active coordinator access.

import { getPortalSession, requireSameOrigin } from './portal-auth.mjs';

function unverifiedCoordinatorResponse() {
  return new Response(JSON.stringify({ error: 'Private tool access could not be verified.' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Returns either a verified coordinator session or { response } containing the
// 401/403 that should be returned to the browser. Keep this response-first
// contract fail-closed if a dependency ever returns contradictory data.
export async function getCoordinatorSession() {
  const session = await getPortalSession({ activeOnly: true, role: 'coordinator' });
  if (session?.response) return { response: session.response };
  if (session?.profile?.status !== 'active' || session.profile.role !== 'coordinator') {
    return { response: unverifiedCoordinatorResponse() };
  }
  return session;
}

function isMutation(req) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
}

// Returns an error Response unless the current Netlify Identity session belongs
// to an active coordinator. Mutations also require an explicit same-origin
// request before any domain handler performs a write.
export async function requireAuth(req) {
  const session = await getCoordinatorSession();
  if (session.response) return session.response;
  if (isMutation(req)) return requireSameOrigin(req);
  return null;
}
