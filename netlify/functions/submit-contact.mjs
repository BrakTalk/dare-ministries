// POST /api/contact — receives contact form submissions.
import { getDatabase } from '@netlify/database';
import { json, readBody, cleanText, isValidEmail, notify } from './lib/helpers.mjs';

export const config = { path: '/api/contact' };

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await readBody(req);
  if (!body) return json({ error: 'Invalid request body' }, 400);

  const name = cleanText(body.name, 200);
  const email = cleanText(body.email, 200);
  const subject = cleanText(body.subject, 200);
  const message = cleanText(body.message, 5000);
  if (!name || !isValidEmail(email) || !message) {
    return json({ error: 'Name, a valid email, and a message are required' }, 400);
  }

  const db = getDatabase();
  await db.sql`
    INSERT INTO contacts (name, email, subject, message)
    VALUES (${name}, ${email}, ${subject}, ${message})
  `;

  await notify(
    `New contact message from ${name}`,
    [`Name: ${name}`, `Email: ${email}`, `Subject: ${subject || '—'}`, '', message].join('\n')
  );

  return json({ ok: true });
};
