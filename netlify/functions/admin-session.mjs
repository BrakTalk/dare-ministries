// GET /api/admin/session — roster coordinator session status.
import { json } from './lib/helpers.mjs';
import { getCoordinatorSession } from './lib/auth.mjs';

export const config = { path: '/api/admin/session' };

export default async (req) => {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405, { 'Cache-Control': 'no-store' });
  }

  const session = await getCoordinatorSession();
  if (session.response) return session.response;

  return json(
    {
      authenticated: true,
      profile: {
        display_name: session.profile.display_name,
        email: session.profile.email,
        status: session.profile.status,
        role: session.profile.role,
      },
    },
    200,
    { 'Cache-Control': 'no-store' }
  );
};
