// Published "From the Field" entries, fetched at build time. Publishing from
// the /roster console triggers a rebuild via BUILD_HOOK_URL, so this file is
// the only path from the database to the public site — every source below
// carries the published-only gate that keeps drafts private.
//
// Data source, in order:
//   1. NETLIFY_DATABASE_URL — direct Postgres query (netlify dev, or any
//      environment where the connection string is present).
//   2. Netlify build without the env var (the platform injects it only into
//      the functions runtime) — fetch the site's own /api/field-notes-feed,
//      which runs in that runtime and serves published entries only.
//   3. Neither (plain `npm run dev`) — warn and build with no entries.
const { DateTime } = require('luxon');

function formatDateRange(startDate, endDate) {
  const start = DateTime.fromJSDate(new Date(startDate), { zone: 'utc' });
  if (!endDate) return start.toFormat('LLLL d, yyyy');
  const end = DateTime.fromJSDate(new Date(endDate), { zone: 'utc' });
  if (start.hasSame(end, 'day')) return start.toFormat('LLLL d, yyyy');
  if (start.hasSame(end, 'month')) {
    return `${start.toFormat('LLLL d')}–${end.toFormat('d, yyyy')}`;
  }
  if (start.hasSame(end, 'year')) {
    return `${start.toFormat('LLLL d')} – ${end.toFormat('LLLL d, yyyy')}`;
  }
  return `${start.toFormat('LLLL d, yyyy')} – ${end.toFormat('LLLL d, yyyy')}`;
}

function shape(notes, photos) {
  return notes.map((note) => {
    const notePhotos = photos
      .filter((p) => p.note_id === note.id)
      .map((p) => ({
        url: `/images/field/${note.id}/${p.id}`,
        alt: p.alt || '',
        is_cover: p.is_cover,
      }));
    return {
      ...note,
      photos: notePhotos,
      cover: notePhotos.find((p) => p.is_cover) || notePhotos[0] || null,
      date_display: formatDateRange(note.start_date, note.end_date),
    };
  });
}

module.exports = async function () {
  // Direct database access. A query failure here throws and fails the build:
  // the previous good deploy stays live instead of shipping an empty archive.
  if (process.env.NETLIFY_DATABASE_URL) {
    const { getDatabase } = await import('@netlify/database');
    const db = getDatabase();

    const notes = await db.sql`
      SELECT id, slug, title, start_date, end_date, body, published_at
      FROM field_notes
      WHERE status = 'published'
      ORDER BY start_date DESC, created_at DESC
    `;
    if (!notes.length) return [];

    const ids = notes.map((n) => n.id);
    const photos = await db.sql`
      SELECT id, note_id, alt, is_cover
      FROM field_note_photos
      WHERE note_id = ANY(${ids})
      ORDER BY sort_order, created_at
    `;
    return shape(notes, photos);
  }

  // Netlify build without direct DB access: fetch the live site's feed
  // function. process.env.URL points at the current production deploy, so a
  // 404 means the feed function hasn't shipped yet (the very first deploy of
  // this code) — warn and build empty rather than deadlock the deploy. Any
  // other failure throws to protect the existing archive.
  if (process.env.NETLIFY === 'true' && process.env.URL) {
    const feedUrl = `${process.env.URL}/api/field-notes-feed`;
    const res = await fetch(feedUrl);
    if (res.status === 404) {
      console.warn(`[fieldNotes] ${feedUrl} not found (first deploy of the feed?) — building with no field notes`);
      return [];
    }
    if (!res.ok) {
      throw new Error(`[fieldNotes] feed fetch failed: ${res.status} from ${feedUrl}`);
    }
    const { notes, photos } = await res.json();
    if (!notes.length) return [];
    return shape(notes, photos);
  }

  console.warn('[fieldNotes] no database access — building with no field notes');
  return [];
};
