// Published "From the Field" entries, fetched from Netlify DB at build time.
// Publishing from the /roster console triggers a rebuild via BUILD_HOOK_URL,
// so this file is the only path from the database to the public site — the
// WHERE status = 'published' filter below is what keeps drafts private.
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

module.exports = async function () {
  if (!process.env.NETLIFY_DATABASE_URL) {
    console.warn('[fieldNotes] NETLIFY_DATABASE_URL not set — building with no field notes');
    return [];
  }

  // Let a database failure fail the build: the previous good deploy stays
  // live instead of shipping an empty archive over a populated one.
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
};
