// /api/admin/volunteers — roster management (list, update status/notes, delete).
import { getDatabase } from '@netlify/database';
import { json, readBody, cleanText } from './lib/helpers.mjs';
import { requireAuth } from './lib/auth.mjs';

export const config = { path: '/api/admin/volunteers' };

const STATUSES = ['new', 'contacted', 'active', 'inactive'];

export default async (req) => {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  const db = getDatabase();

  if (req.method === 'GET') {
    const rows = await db.sql`SELECT * FROM volunteers ORDER BY created_at DESC`;
    return json(rows);
  }

  if (req.method === 'PATCH') {
    const body = await readBody(req);
    if (!body?.id) return json({ error: 'id is required' }, 400);

    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return json({ error: 'Invalid status' }, 400);
      await db.sql`UPDATE volunteers SET status = ${body.status} WHERE id = ${body.id}`;
    }
    if (body.notes !== undefined) {
      await db.sql`UPDATE volunteers SET notes = ${cleanText(body.notes, 2000)} WHERE id = ${body.id}`;
    }
    return json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const body = await readBody(req);
    if (!body?.id) return json({ error: 'id is required' }, 400);
    await db.sql`DELETE FROM volunteers WHERE id = ${body.id}`;
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
};
