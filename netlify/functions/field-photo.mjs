// /images/field/:noteId/:photoId — serves field note photos from the Netlify
// Blobs store. Photos of published notes are public with long-lived CDN
// caching (immutable is safe: keys are write-once). Photos of draft notes are
// only served to a valid admin session — the roster console previews draft
// thumbnails through this same route — with no-store so the CDN never caches
// an authorized response for public reuse. Blobs with no matching metadata
// row (orphans, deleted notes) are never served.
//
// NOTE: src/images/ is passthrough-copied by Eleventy — never create a
// src/images/field/ directory, or the static copy would shadow this route.
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import { FIELD_PHOTOS_STORE, isUuid } from './lib/helpers.mjs';
import { isAuthenticated } from './lib/auth.mjs';

export const config = { path: '/images/field/:noteId/:photoId' };

export default async (req, context) => {
  const { noteId, photoId } = context.params;
  if (!isUuid(noteId) || !isUuid(photoId)) {
    return new Response('Not found', { status: 404 });
  }

  const db = getDatabase();
  const rows = await db.sql`
    SELECT n.status FROM field_note_photos p
    JOIN field_notes n ON n.id = p.note_id
    WHERE p.id = ${photoId} AND p.note_id = ${noteId}
  `;
  if (!rows.length) return new Response('Not found', { status: 404 });

  const published = rows[0].status === 'published';
  if (!published && !isAuthenticated(req)) {
    return new Response('Not found', { status: 404 });
  }

  const store = getStore(FIELD_PHOTOS_STORE);
  const blob = await store.getWithMetadata(`${noteId}/${photoId}`, { type: 'stream' });
  if (!blob) return new Response('Not found', { status: 404 });

  return new Response(blob.data, {
    headers: {
      'Content-Type': blob.metadata?.contentType || 'image/jpeg',
      'Cache-Control': published ? 'public, max-age=31536000, immutable' : 'private, no-store',
    },
  });
};
