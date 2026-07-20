// /api/admin/field-note-photos — photo upload/manage for field notes.
// POST takes the raw image bytes as the request body (not JSON):
//   POST /api/admin/field-note-photos?note_id=<uuid>&alt=<text>
//   Content-Type: image/jpeg | image/png | image/webp
// Binaries live in the Netlify Blobs store under <note_id>/<photo_id>;
// metadata rows live in field_note_photos.
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import { json, readBody, cleanText, isUuid, triggerBuild, FIELD_PHOTOS_STORE } from './lib/helpers.mjs';
import { requireAuth } from './lib/auth.mjs';

export const config = { path: '/api/admin/field-note-photos' };

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024; // stay under Netlify's ~6 MB function body limit

async function rebuildIfPublished(db, noteId) {
  const rows = await db.sql`SELECT status FROM field_notes WHERE id = ${noteId}`;
  if (rows[0]?.status === 'published') await triggerBuild();
}

export default async (req) => {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  const db = getDatabase();

  if (req.method === 'POST') {
    const url = new URL(req.url);
    const noteId = url.searchParams.get('note_id');
    const alt = cleanText(url.searchParams.get('alt'), 300);
    const contentType = (req.headers.get('content-type') || '').split(';')[0].trim();

    if (!isUuid(noteId)) return json({ error: 'A valid note_id is required' }, 400);
    if (!ALLOWED_TYPES.includes(contentType)) {
      return json({ error: 'Only JPEG, PNG, and WebP photos are supported' }, 415);
    }

    const buffer = await req.arrayBuffer();
    if (!buffer.byteLength) return json({ error: 'Empty upload' }, 400);
    if (buffer.byteLength > MAX_BYTES) {
      return json({ error: 'Photo too large (5 MB max) — try again' }, 413);
    }

    const note = (await db.sql`SELECT id FROM field_notes WHERE id = ${noteId}`)[0];
    if (!note) return json({ error: 'Entry not found' }, 404);

    const rows = await db.sql`
      INSERT INTO field_note_photos (note_id, content_type, alt)
      VALUES (${noteId}, ${contentType}, ${alt})
      RETURNING id
    `;
    const photoId = rows[0].id;

    try {
      const store = getStore(FIELD_PHOTOS_STORE);
      await store.set(`${noteId}/${photoId}`, buffer, { metadata: { contentType } });
    } catch (err) {
      // No blob means a broken image — roll the metadata row back.
      await db.sql`DELETE FROM field_note_photos WHERE id = ${photoId}`;
      console.error('Photo blob write failed:', err);
      return json({ error: 'Photo upload failed — please try again' }, 500);
    }

    await rebuildIfPublished(db, noteId);
    return json({ ok: true, id: photoId, url: `/images/field/${noteId}/${photoId}` }, 201);
  }

  if (req.method === 'PATCH') {
    const body = await readBody(req);
    if (!isUuid(body?.id)) return json({ error: 'A valid id is required' }, 400);

    const photo = (await db.sql`SELECT * FROM field_note_photos WHERE id = ${body.id}`)[0];
    if (!photo) return json({ error: 'Photo not found' }, 404);

    if (body.alt !== undefined) {
      await db.sql`UPDATE field_note_photos SET alt = ${cleanText(body.alt, 300)} WHERE id = ${body.id}`;
    }
    if (body.sort_order !== undefined && Number.isInteger(body.sort_order)) {
      await db.sql`UPDATE field_note_photos SET sort_order = ${body.sort_order} WHERE id = ${body.id}`;
    }
    if (body.is_cover === true) {
      // Single statement so the swap is atomic — no window where the note has
      // zero or two cover photos under concurrent requests.
      await db.sql`UPDATE field_note_photos SET is_cover = (id = ${body.id}) WHERE note_id = ${photo.note_id}`;
    } else if (body.is_cover === false) {
      await db.sql`UPDATE field_note_photos SET is_cover = FALSE WHERE id = ${body.id}`;
    }

    await rebuildIfPublished(db, photo.note_id);
    return json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const body = await readBody(req);
    if (!isUuid(body?.id)) return json({ error: 'A valid id is required' }, 400);

    const photo = (await db.sql`SELECT * FROM field_note_photos WHERE id = ${body.id}`)[0];
    if (!photo) return json({ error: 'Photo not found' }, 404);

    const store = getStore(FIELD_PHOTOS_STORE);
    await store.delete(`${photo.note_id}/${photo.id}`);
    await db.sql`DELETE FROM field_note_photos WHERE id = ${body.id}`;

    await rebuildIfPublished(db, photo.note_id);
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
};
