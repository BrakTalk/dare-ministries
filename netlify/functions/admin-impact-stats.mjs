// PUT /api/admin/impact-stats — update the six impact counter numbers.
import { getDatabase } from '@netlify/database';
import { json, readBody } from './lib/helpers.mjs';
import { requireAuth } from './lib/auth.mjs';

export const config = { path: '/api/admin/impact-stats' };

const FIELDS = [
  'homes_repaired',
  'volunteer_hours',
  'deployments_completed',
  'partner_organizations',
  'families_helped',
  'years_of_service',
];

export default async (req) => {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  if (req.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);

  const body = await readBody(req);
  if (!body) return json({ error: 'Invalid request body' }, 400);

  const values = {};
  for (const field of FIELDS) {
    // Guard against Number() coercion quirks: '', null, and false all become 0,
    // which would silently zero a counter.
    const raw = body[field];
    if (
      (typeof raw !== 'string' && typeof raw !== 'number') ||
      (typeof raw === 'string' && !raw.trim())
    ) {
      return json({ error: `${field} must be a non-negative whole number` }, 400);
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 100000000) {
      return json({ error: `${field} must be a non-negative whole number` }, 400);
    }
    values[field] = n;
  }

  const db = getDatabase();
  await db.sql`
    UPDATE impact_stats SET
      homes_repaired        = ${values.homes_repaired},
      volunteer_hours       = ${values.volunteer_hours},
      deployments_completed = ${values.deployments_completed},
      partner_organizations = ${values.partner_organizations},
      families_helped       = ${values.families_helped},
      years_of_service      = ${values.years_of_service},
      updated_at            = NOW()
    WHERE id = 1
  `;

  return json({ ok: true });
};
