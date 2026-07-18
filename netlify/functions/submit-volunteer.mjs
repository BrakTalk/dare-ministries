// POST /api/volunteer — receives Volunteer Interest Form submissions.
import { getDatabase } from '@netlify/database';
import { json, readBody, cleanText, isValidEmail, notify } from './lib/helpers.mjs';

export const config = { path: '/api/volunteer' };

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await readBody(req);
  if (!body) return json({ error: 'Invalid request body' }, 400);

  const name = cleanText(body.name, 200);
  const email = cleanText(body.email, 200);
  if (!name || !isValidEmail(email)) {
    return json({ error: 'Name and a valid email are required' }, 400);
  }

  const phone = cleanText(body.phone, 50);
  const organization = cleanText(body.organization, 200);
  const skills = cleanText(body.skills, 2000);
  const availability = cleanText(body.availability, 50);
  const notes = cleanText(body.notes, 2000);

  const db = getDatabase();
  await db.sql`
    INSERT INTO volunteers (name, email, phone, organization, skills, availability, notes)
    VALUES (${name}, ${email}, ${phone}, ${organization}, ${skills}, ${availability}, ${notes})
  `;

  await notify(
    `New volunteer signup: ${name}`,
    [
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone || '—'}`,
      `Church/Organization: ${organization || '—'}`,
      `Skills: ${skills || '—'}`,
      `Availability: ${availability || '—'}`,
      `Notes: ${notes || '—'}`,
    ].join('\n')
  );

  return json({ ok: true });
};
