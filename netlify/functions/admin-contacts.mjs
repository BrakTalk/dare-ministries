// /api/admin/contacts — contact form inbox (list, mark read/unread, delete).
import { getDatabase } from '@netlify/database';
import { json, readBody } from './lib/helpers.mjs';
import { requireAuth } from './lib/auth.mjs';

export const config = { path: '/api/admin/contacts' };

export default async (req) => {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  const db = getDatabase();

  if (req.method === 'GET') {
    const rows = await db.sql`SELECT * FROM contacts ORDER BY created_at DESC`;
    return json(rows);
  }

  if (req.method === 'PATCH') {
    const body = await readBody(req);
    if (!body?.id) return json({ error: 'id is required' }, 400);
    if (typeof body.read !== 'boolean') {
      return json({ error: 'read must be a boolean' }, 400);
    }
    if (body.read) {
      await db.sql`UPDATE contacts SET read_at = NOW() WHERE id = ${body.id} AND read_at IS NULL`;
    } else {
      await db.sql`UPDATE contacts SET read_at = NULL WHERE id = ${body.id}`;
    }
    return json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const body = await readBody(req);
    if (!body?.id) return json({ error: 'id is required' }, 400);
    await db.sql`DELETE FROM contacts WHERE id = ${body.id}`;
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
};
