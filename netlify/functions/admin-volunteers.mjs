// /api/admin/volunteers — roster management (list, update status/notes, delete).
import { getDatabase } from '@netlify/database';
import { json, readBody, cleanText, isValidEmail } from './lib/helpers.mjs';
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

  // Manual roster entry from the console (walk-ups, phone calls, spreadsheet
  // rows) — unlike the public form, admins may set the status directly.
  if (req.method === 'POST') {
    const body = await readBody(req);
    if (!body) return json({ error: 'Invalid request body' }, 400);

    const name = cleanText(body.name, 200);
    const email = cleanText(body.email, 200);
    if (!name || !isValidEmail(email)) {
      return json({ error: 'Name and a valid email are required' }, 400);
    }
    const status = body.status ?? 'new';
    if (!STATUSES.includes(status)) return json({ error: 'Invalid status' }, 400);

    const rows = await db.sql`
      INSERT INTO volunteers (name, email, phone, organization, skills, availability, notes, status)
      VALUES (
        ${name},
        ${email},
        ${cleanText(body.phone, 50)},
        ${cleanText(body.organization, 200)},
        ${cleanText(body.skills, 2000)},
        ${cleanText(body.availability, 50)},
        ${cleanText(body.notes, 2000)},
        ${status}
      )
      RETURNING id
    `;
    return json({ ok: true, id: rows[0].id }, 201);
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
