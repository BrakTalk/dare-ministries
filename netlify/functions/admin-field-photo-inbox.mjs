// /api/admin/field-photo-inbox — coordinator moderation for emailed photos.
// GET lists pending submissions or streams a private preview. PATCH saves
// coordinator corrections. POST approves selected files or rejects a message.
import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import {
  FIELD_PHOTO_INBOX_STORE,
  FIELD_PHOTOS_STORE,
  cleanText,
  isValidIsoDate,
  isUuid,
  json,
  readBody,
  triggerBuild,
} from './lib/helpers.mjs';
import { getCoordinatorSession } from './lib/auth.mjs';
import { requireSameOrigin } from './lib/portal-auth.mjs';
import { coordinateGroupLabel } from './lib/field-photo-processing.mjs';

export const config = { path: '/api/admin/field-photo-inbox' };

const MAX_SELECTION = 12;

function intakeAddress() {
  return (
    String(process.env.FIELD_PHOTO_INBOX_RECIPIENTS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)[0] || null
  );
}

function publicFile(file) {
  return {
    id: file.id,
    submission_id: file.submission_id,
    original_filename: file.original_filename,
    content_type: file.content_type,
    byte_size: file.byte_size,
    width: file.width,
    height: file.height,
    captured_at_local: file.captured_at_local,
    captured_offset_minutes: file.captured_offset_minutes,
    captured_date: file.captured_date,
    gps_latitude: file.gps_latitude,
    gps_longitude: file.gps_longitude,
    location_label: file.location_label,
    location_group:
      file.location_label || coordinateGroupLabel(file.gps_latitude, file.gps_longitude),
    alt: file.alt,
    status: file.status,
    failure_reason: file.failure_reason,
    preview_url: `/api/admin/field-photo-inbox?file_id=${encodeURIComponent(file.id)}&variant=image`,
    thumbnail_url: `/api/admin/field-photo-inbox?file_id=${encodeURIComponent(file.id)}&variant=thumbnail`,
  };
}

async function serveFile(req, db, fileId) {
  if (!isUuid(fileId)) return new Response('Not found', { status: 404 });
  const variant = new URL(req.url).searchParams.get('variant') === 'image' ? 'image' : 'thumbnail';
  const rows = await db.sql`
    SELECT inbox_blob_key, thumbnail_blob_key
    FROM field_photo_submission_files
    WHERE id = ${fileId} AND status IN ('ready', 'approved')
  `;
  const file = rows[0];
  const key = variant === 'image' ? file?.inbox_blob_key : file?.thumbnail_blob_key;
  if (!key) return new Response('Not found', { status: 404 });

  const store = getStore(FIELD_PHOTO_INBOX_STORE);
  const blob = await store.getWithMetadata(key, { type: 'stream', consistency: 'strong' });
  if (!blob) return new Response('Not found', { status: 404 });
  return new Response(blob.data, {
    headers: {
      'Content-Type': blob.metadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function listInbox(db) {
  const submissions = await db.sql`
    SELECT *
    FROM field_photo_submissions
    WHERE status IN ('processing', 'ready', 'partial', 'failed', 'no_photos')
    ORDER BY received_at DESC, created_at DESC
  `;
  const ids = submissions.map((submission) => submission.id);
  let files = [];
  if (ids.length) {
    files = await db.sql`
      SELECT *
      FROM field_photo_submission_files
      WHERE submission_id = ANY(${ids})
      ORDER BY captured_date NULLS LAST, created_at, id
    `;
  }
  const notes = await db.sql`
    SELECT id, title, status, start_date, end_date
    FROM field_notes
    ORDER BY start_date DESC, created_at DESC
  `;

  return {
    configured: Boolean(intakeAddress()),
    inbox_address: intakeAddress(),
    submissions: submissions.map((submission) => ({
      ...submission,
      files: files.filter((file) => file.submission_id === submission.id).map(publicFile),
    })),
    notes,
  };
}

function validatedDate(value) {
  if (value === null || value === '') return null;
  return isValidIsoDate(value) ? value : undefined;
}

async function saveMetadata(db, session, body) {
  if (
    !isUuid(body?.submission_id) ||
    !Array.isArray(body.files) ||
    body.files.length > MAX_SELECTION
  ) {
    return json({ error: 'A valid submission and photo list are required.' }, 400);
  }
  const files = body.files.map((item) => ({
    id: item?.id,
    capturedDate: validatedDate(item?.captured_date),
    locationLabel: cleanText(item?.location_label, 160),
    alt: cleanText(item?.alt, 300),
  }));
  if (files.some((file) => !isUuid(file.id) || file.capturedDate === undefined)) {
    return json({ error: 'Each photo needs a valid id and capture date.' }, 400);
  }

  let updated = 0;
  for (const file of files) {
    const rows = await db.sql`
      UPDATE field_photo_submission_files SET
        captured_date = ${file.capturedDate},
        location_label = ${file.locationLabel},
        alt = ${file.alt},
        updated_at = NOW()
      WHERE id = ${file.id}
        AND submission_id = ${body.submission_id}
        AND status = 'ready'
      RETURNING id
    `;
    updated += rows.length;
  }
  await db.sql`
    INSERT INTO field_photo_submission_events (
      submission_id,
      actor_profile_id,
      action,
      details
    )
    VALUES (
      ${body.submission_id},
      ${session.profile.id},
      'metadata_updated',
      ${JSON.stringify({ files: updated })}::JSONB
    )
  `;
  return json({ ok: true, updated });
}

async function rejectSubmission(db, session, submissionId) {
  const submissions = await db.sql`
    SELECT id FROM field_photo_submissions
    WHERE id = ${submissionId} AND status NOT IN ('approved', 'rejected')
  `;
  if (!submissions.length) return json({ error: 'Submission not found or already closed.' }, 404);

  const files = await db.sql`
    SELECT inbox_blob_key, thumbnail_blob_key
    FROM field_photo_submission_files
    WHERE submission_id = ${submissionId} AND status != 'approved'
  `;
  const store = getStore(FIELD_PHOTO_INBOX_STORE);
  const keys = files
    .flatMap((file) => [file.inbox_blob_key, file.thumbnail_blob_key])
    .filter(Boolean);
  await Promise.allSettled(keys.map((key) => store.delete(key)));

  await db.sql`
      UPDATE field_photo_submission_files
    SET
      status = CASE WHEN status = 'approved' THEN status ELSE 'rejected' END,
      inbox_blob_key = CASE WHEN status = 'approved' THEN inbox_blob_key ELSE NULL END,
      thumbnail_blob_key = CASE WHEN status = 'approved' THEN thumbnail_blob_key ELSE NULL END,
      gps_latitude = CASE WHEN status = 'approved' THEN gps_latitude ELSE NULL END,
      gps_longitude = CASE WHEN status = 'approved' THEN gps_longitude ELSE NULL END,
      exif_subset = CASE WHEN status = 'approved' THEN exif_subset ELSE '{}'::JSONB END,
      updated_at = NOW()
    WHERE submission_id = ${submissionId}
  `;
  await db.sql`
    UPDATE field_photo_submissions
    SET
      status = 'rejected',
      reviewed_by = ${session.profile.id},
      reviewed_at = NOW(),
      updated_at = NOW()
    WHERE id = ${submissionId}
  `;
  await db.sql`
    INSERT INTO field_photo_submission_events (
      submission_id,
      actor_profile_id,
      action,
      details
    )
    VALUES (
      ${submissionId},
      ${session.profile.id},
      'rejected',
      ${JSON.stringify({ files: files.length })}::JSONB
    )
  `;
  return json({ ok: true });
}

async function approveFiles(db, session, body) {
  if (
    !isUuid(body?.submission_id) ||
    !isUuid(body?.note_id) ||
    !Array.isArray(body.files) ||
    !body.files.length ||
    body.files.length > MAX_SELECTION
  ) {
    return json({ error: 'Select a Field Note and at least one valid photo.' }, 400);
  }
  if (body.files.some((item) => !isUuid(item?.id))) {
    return json({ error: 'The photo selection is invalid.' }, 400);
  }

  const note = (await db.sql`SELECT id, status FROM field_notes WHERE id = ${body.note_id}`)[0];
  if (!note) return json({ error: 'Field Note not found.' }, 404);

  const requestedIds = body.files.map((item) => item.id);
  const files = await db.sql`
    SELECT *
    FROM field_photo_submission_files
    WHERE submission_id = ${body.submission_id}
      AND id = ANY(${requestedIds})
      AND status = 'ready'
  `;
  if (files.length !== requestedIds.length) {
    return json({ error: 'One or more selected photos are unavailable.' }, 409);
  }

  const orderRows = await db.sql`
    SELECT COALESCE(MAX(sort_order), -1)::INTEGER AS max_order
    FROM field_note_photos
    WHERE note_id = ${body.note_id}
  `;
  let sortOrder = Number(orderRows[0]?.max_order ?? -1) + 1;
  const inboxStore = getStore(FIELD_PHOTO_INBOX_STORE);
  const finalStore = getStore(FIELD_PHOTOS_STORE);
  const approved = [];
  const requestedCover = body.files.find((item) => item.is_cover === true)?.id || null;

  for (const file of files) {
    const item = body.files.find((candidate) => candidate.id === file.id);
    const capturedDate = validatedDate(item.captured_date);
    if (capturedDate === undefined) {
      return json({ error: 'A selected photo has an invalid capture date.' }, 400);
    }
    const image = await inboxStore.get(file.inbox_blob_key, {
      type: 'arrayBuffer',
      consistency: 'strong',
    });
    if (!image) return json({ error: 'A selected photo is no longer available.' }, 409);

    const photoId = randomUUID();
    const finalKey = `${body.note_id}/${photoId}`;
    await finalStore.set(finalKey, image, { metadata: { contentType: 'image/jpeg' } });
    try {
      const locationLabel = cleanText(item.location_label, 160);
      const alt = cleanText(item.alt, 300);
      const coordinatorChangedMetadata =
        capturedDate !== String(file.captured_date || '').slice(0, 10) ||
        locationLabel !== (file.location_label || null);
      await db.sql`
        INSERT INTO field_note_photos (
          id,
          note_id,
          content_type,
          alt,
          is_cover,
          sort_order,
          captured_at_local,
          captured_offset_minutes,
          captured_date,
          location_label,
          metadata_source
        )
        VALUES (
          ${photoId},
          ${body.note_id},
          'image/jpeg',
          ${alt},
          FALSE,
          ${sortOrder},
          ${file.captured_at_local},
          ${file.captured_offset_minutes},
          ${capturedDate},
          ${locationLabel},
          ${coordinatorChangedMetadata ? 'coordinator' : Object.keys(file.exif_subset || {}).length ? 'exif' : 'email'}
        )
      `;
      await db.sql`
        UPDATE field_photo_submission_files
        SET
          status = 'approved',
          approved_photo_id = ${photoId},
          captured_date = ${capturedDate},
          location_label = ${locationLabel},
          alt = ${alt},
          gps_latitude = NULL,
          gps_longitude = NULL,
          exif_subset = '{}'::JSONB,
          updated_at = NOW()
        WHERE id = ${file.id} AND status = 'ready'
      `;
      approved.push({ file_id: file.id, photo_id: photoId });
      sortOrder += 1;

      // The sanitized final photo is now durable. Remove the private duplicate
      // and thumbnail; if a transient delete fails, keep the keys in the row so
      // the scheduled retention job can retry without exposing the objects.
      const cleanup = await Promise.allSettled([
        inboxStore.delete(file.inbox_blob_key),
        file.thumbnail_blob_key ? inboxStore.delete(file.thumbnail_blob_key) : Promise.resolve(),
      ]);
      if (cleanup.every((result) => result.status === 'fulfilled')) {
        await db.sql`
          UPDATE field_photo_submission_files
          SET inbox_blob_key = NULL, thumbnail_blob_key = NULL, updated_at = NOW()
          WHERE id = ${file.id}
        `;
      }
    } catch (error) {
      await finalStore.delete(finalKey).catch(() => {});
      throw error;
    }
  }

  if (requestedCover) {
    const cover = approved.find((item) => item.file_id === requestedCover);
    if (cover) {
      await db.sql`
        UPDATE field_note_photos
        SET is_cover = (id = ${cover.photo_id})
        WHERE note_id = ${body.note_id}
      `;
    }
  }

  const remaining = await db.sql`
    SELECT COUNT(*)::INTEGER AS count
    FROM field_photo_submission_files
    WHERE submission_id = ${body.submission_id} AND status = 'ready'
  `;
  const status = Number(remaining[0]?.count || 0) ? 'partial' : 'approved';
  await db.sql`
    UPDATE field_photo_submissions
    SET
      status = ${status},
      reviewed_by = ${session.profile.id},
      reviewed_at = NOW(),
      updated_at = NOW()
    WHERE id = ${body.submission_id}
  `;
  await db.sql`
    INSERT INTO field_photo_submission_events (
      submission_id,
      actor_profile_id,
      action,
      details
    )
    VALUES (
      ${body.submission_id},
      ${session.profile.id},
      'approved',
      ${JSON.stringify({ note_id: body.note_id, files: approved })}::JSONB
    )
  `;
  if (note.status === 'published') await triggerBuild();
  return json({ ok: true, approved, status });
}

export default async (req) => {
  const session = await getCoordinatorSession();
  if (session.response) return session.response;
  const db = session.db;

  if (req.method === 'GET') {
    const fileId = new URL(req.url).searchParams.get('file_id');
    if (fileId) return serveFile(req, db, fileId);
    return json(await listInbox(db), 200, { 'Cache-Control': 'no-store' });
  }

  if (!['PATCH', 'POST'].includes(req.method)) {
    return json({ error: 'Method not allowed.' }, 405, { 'Cache-Control': 'no-store' });
  }

  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;
  const body = await readBody(req);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  if (req.method === 'PATCH') return saveMetadata(db, session, body);
  if (req.method === 'POST' && body.action === 'reject' && isUuid(body.submission_id)) {
    return rejectSubmission(db, session, body.submission_id);
  }
  if (req.method === 'POST' && body.action === 'approve') {
    return approveFiles(db, session, body);
  }
  return json({ error: 'Method or action not allowed.' }, 405);
};
