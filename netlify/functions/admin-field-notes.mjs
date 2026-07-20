// /api/admin/field-notes — "From the Field" trip recap CRUD for the /roster
// console. Published entries are baked into the static site at build time
// (src/_data/fieldNotes.js), so every mutation that touches a published entry
// triggers a rebuild via the BUILD_HOOK_URL hook.
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import { json, readBody, cleanText, triggerBuild, FIELD_PHOTOS_STORE } from './lib/helpers.mjs';
import { requireAuth } from './lib/auth.mjs';

export const config = { path: '/api/admin/field-notes' };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function slugify(title, startDate) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${startDate.slice(0, 7)}-${base}`;
}

async function insertWithUniqueSlug(db, { title, startDate, endDate, body }) {
  const base = slugify(title, startDate);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      const rows = await db.sql`
        INSERT INTO field_notes (slug, title, start_date, end_date, body)
        VALUES (${slug}, ${title}, ${startDate}, ${endDate}, ${body})
        RETURNING id, slug
      `;
      return rows[0];
    } catch (err) {
      if (!/unique|duplicate/i.test(String(err))) throw err;
    }
  }
  throw new Error('Could not generate a unique slug');
}

export default async (req) => {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  const db = getDatabase();

  if (req.method === 'GET') {
    const notes = await db.sql`SELECT * FROM field_notes ORDER BY start_date DESC, created_at DESC`;
    const photos = await db.sql`SELECT * FROM field_note_photos ORDER BY sort_order, created_at`;
    return json(
      notes.map((note) => ({
        ...note,
        photos: photos
          .filter((p) => p.note_id === note.id)
          .map((p) => ({ ...p, url: `/images/field/${note.id}/${p.id}` })),
      }))
    );
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    if (!body) return json({ error: 'Invalid request body' }, 400);

    const title = cleanText(body.title, 200);
    const startDate = cleanText(body.start_date, 10);
    const endDate = cleanText(body.end_date, 10);
    if (!title) return json({ error: 'Title is required' }, 400);
    if (!startDate || !ISO_DATE.test(startDate)) {
      return json({ error: 'A valid start date is required' }, 400);
    }
    if (endDate && !ISO_DATE.test(endDate)) return json({ error: 'Invalid end date' }, 400);

    const row = await insertWithUniqueSlug(db, {
      title,
      startDate,
      endDate,
      body: cleanText(body.body, 50000) || '',
    });
    return json({ ok: true, id: row.id, slug: row.slug }, 201);
  }

  if (req.method === 'PATCH') {
    const body = await readBody(req);
    if (!body?.id) return json({ error: 'id is required' }, 400);

    const existing = (await db.sql`SELECT * FROM field_notes WHERE id = ${body.id}`)[0];
    if (!existing) return json({ error: 'Entry not found' }, 404);

    const title = body.title !== undefined ? cleanText(body.title, 200) : existing.title;
    const startDate =
      body.start_date !== undefined ? cleanText(body.start_date, 10) : isoDate(existing.start_date);
    const endDate =
      body.end_date !== undefined ? cleanText(body.end_date, 10) : isoDate(existing.end_date);
    const noteBody = body.body !== undefined ? cleanText(body.body, 50000) || '' : existing.body;

    if (!title) return json({ error: 'Title is required' }, 400);
    if (!startDate || !ISO_DATE.test(startDate)) {
      return json({ error: 'A valid start date is required' }, 400);
    }
    if (endDate && !ISO_DATE.test(endDate)) return json({ error: 'Invalid end date' }, 400);

    // Slugs follow the title/dates only until the entry has ever been
    // published — once a URL may be out in the wild it stays stable.
    let slug = existing.slug;
    if (!existing.published_at && (title !== existing.title || startDate !== isoDate(existing.start_date))) {
      slug = slugify(title, startDate);
      const clash = await db.sql`
        SELECT 1 FROM field_notes WHERE slug = ${slug} AND id != ${body.id}
      `;
      if (clash.length) slug = `${slug}-2`;
    }

    let status = existing.status;
    if (body.status !== undefined) {
      if (!['draft', 'published'].includes(body.status)) return json({ error: 'Invalid status' }, 400);
      status = body.status;
    }

    await db.sql`
      UPDATE field_notes SET
        title = ${title},
        start_date = ${startDate},
        end_date = ${endDate},
        body = ${noteBody},
        slug = ${slug},
        status = ${status},
        published_at = ${status === 'published' ? (existing.published_at || new Date().toISOString()) : existing.published_at},
        updated_at = NOW()
      WHERE id = ${body.id}
    `;

    // Rebuild when the public site is affected: the entry is published now
    // (content/status changed) or was published before (unpublished just now).
    if (status === 'published' || existing.status === 'published') {
      await triggerBuild();
    }
    return json({ ok: true, slug });
  }

  if (req.method === 'DELETE') {
    const body = await readBody(req);
    if (!body?.id) return json({ error: 'id is required' }, 400);

    const existing = (await db.sql`SELECT * FROM field_notes WHERE id = ${body.id}`)[0];
    if (!existing) return json({ error: 'Entry not found' }, 404);

    // Remove photo binaries first; the metadata rows cascade with the note.
    const store = getStore(FIELD_PHOTOS_STORE);
    const { blobs } = await store.list({ prefix: `${body.id}/` });
    await Promise.all(blobs.map((blob) => store.delete(blob.key)));

    await db.sql`DELETE FROM field_notes WHERE id = ${body.id}`;

    if (existing.status === 'published') await triggerBuild();
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
};

// Postgres DATE columns come back as Date objects; compare/patch in ISO form.
function isoDate(value) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}
