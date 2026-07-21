// Shared helpers for the form/API functions.

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export async function readBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

// Trim, collapse to null when empty, and cap length so nobody can dump
// megabytes into a text column.
export function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

// Netlify Blobs store for field note photos. Baked into the upload, serve,
// and delete paths — renaming it would orphan every existing photo.
export const FIELD_PHOTOS_STORE = 'field-photos';

// Asks Netlify to rebuild the static site (published field notes are baked in
// at build time). Fire-and-forget: the DB write already succeeded, so a hook
// failure only delays the site update — never fail the request over it.
export async function triggerBuild() {
  const url = process.env.BUILD_HOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) console.error('Build hook failed:', res.status);
  } catch (err) {
    console.error('Build hook failed:', err);
  }
}

// UUID guard for ids that flow into UUID columns / blob keys — reject
// malformed values with a clean 400 instead of a database error.
export function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Sends a notification email via Resend when RESEND_API_KEY and NOTIFY_EMAIL
// are configured. A notification failure never fails the submission itself —
// the row is already safely in the database.
export async function notify(subject, text) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  if (!apiKey || !to) return;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.NOTIFY_FROM || 'D.A.R.E. Ministries <onboarding@resend.dev>',
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      console.error('Notification email failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('Notification email failed:', err);
  }
}
