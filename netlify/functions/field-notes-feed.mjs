// /api/field-notes-feed — public, read-only feed of PUBLISHED field notes.
// Exists for the Eleventy build: Netlify's built-in Database injects
// NETLIFY_DATABASE_URL into the functions runtime but NOT into builds, so
// src/_data/fieldNotes.js fetches this endpoint at build time when it has no
// direct database access. Only published entries are exposed — the same
// content the public pages render — so this is not a draft-leakage vector,
// but the WHERE status = 'published' filter below is load-bearing and must
// never be widened.
import { getDatabase } from '@netlify/database';
import { json } from './lib/helpers.mjs';

export const config = { path: '/api/field-notes-feed' };

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const db = getDatabase();
  const notes = await db.sql`
    SELECT id, slug, title, start_date, end_date, body, published_at
    FROM field_notes
    WHERE status = 'published'
    ORDER BY start_date DESC, created_at DESC
  `;

  let photos = [];
  if (notes.length) {
    const ids = notes.map((n) => n.id);
    photos = await db.sql`
      SELECT id, note_id, alt, is_cover
      FROM field_note_photos
      WHERE note_id = ANY(${ids})
      ORDER BY sort_order, created_at
    `;
  }

  // no-store: the build fetches this moments after a publish — a cached
  // response would bake stale content into the new deploy.
  return json({ notes, photos }, 200, { 'Cache-Control': 'no-store' });
};
