// /api/portal/profile — creates/returns the current user's pending profile and
// lets that person maintain their own contact information.

import { json, readBody, cleanText } from './lib/helpers.mjs';
import { getPortalSession, publicProfile, requireSameOrigin } from './lib/portal-auth.mjs';

export const config = { path: '/api/portal/profile' };

export default async (req) => {
  const session = await getPortalSession();
  if (session.response) return session.response;

  if (req.method === 'GET') {
    return json({ profile: publicProfile(session.profile) }, 200, { 'Cache-Control': 'no-store' });
  }

  if (req.method === 'PATCH') {
    const invalidOrigin = requireSameOrigin(req);
    if (invalidOrigin) return invalidOrigin;

    const body = await readBody(req);
    if (!body) return json({ error: 'Invalid request body.' }, 400);

    const displayName = cleanText(body.display_name, 200);
    if (!displayName) return json({ error: 'Your name is required.' }, 400);

    const rows = await session.db.sql`
      UPDATE user_profiles
      SET
        display_name = ${displayName},
        phone = ${cleanText(body.phone, 50)},
        organization = ${cleanText(body.organization, 200)},
        request_reason = ${cleanText(body.request_reason, 2000)},
        updated_at = NOW()
      WHERE id = ${session.profile.id}
      RETURNING *
    `;

    return json({ ok: true, profile: publicProfile(rows[0]) }, 200, {
      'Cache-Control': 'no-store',
    });
  }

  return json({ error: 'Method not allowed.' }, 405);
};
