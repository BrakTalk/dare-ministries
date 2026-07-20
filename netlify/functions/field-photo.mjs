// /images/field/:noteId/:photoId — public, serves field note photos from the
// Netlify Blobs store with long-lived CDN caching. Immutable is safe because
// photo keys are write-once (a photo is never re-uploaded under the same id).
//
// NOTE: src/images/ is passthrough-copied by Eleventy — never create a
// src/images/field/ directory, or the static copy would shadow this route.
import { getStore } from '@netlify/blobs';
import { FIELD_PHOTOS_STORE, isUuid } from './lib/helpers.mjs';

export const config = { path: '/images/field/:noteId/:photoId' };

export default async (req, context) => {
  const { noteId, photoId } = context.params;
  if (!isUuid(noteId) || !isUuid(photoId)) {
    return new Response('Not found', { status: 404 });
  }

  const store = getStore(FIELD_PHOTOS_STORE);
  const blob = await store.getWithMetadata(`${noteId}/${photoId}`, { type: 'stream' });
  if (!blob) return new Response('Not found', { status: 404 });

  return new Response(blob.data, {
    headers: {
      'Content-Type': blob.metadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
