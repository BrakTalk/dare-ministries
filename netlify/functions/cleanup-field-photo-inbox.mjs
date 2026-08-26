// Daily cleanup for abandoned Photo Inbox submissions. Approved/rejected rows
// remain as an audit trail, but private blobs and exact EXIF location data do
// not outlive the configured review window.
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import { FIELD_PHOTO_INBOX_STORE } from './lib/helpers.mjs';
import { deletePrivatePhotoBlobs } from './lib/field-photo-blob-cleanup.mjs';

export const config = { schedule: '@daily' };

function retentionDays() {
  const configured = Number(process.env.FIELD_PHOTO_INBOX_RETENTION_DAYS || 30);
  return Number.isInteger(configured) && configured >= 1 && configured <= 365 ? configured : 30;
}

export default async () => {
  const db = getDatabase();
  const days = retentionDays();
  const store = getStore(FIELD_PHOTO_INBOX_STORE);

  // Approval and rejection keep a private key whenever immediate deletion
  // fails. Retry those terminal rows without changing their audit status.
  const terminalFiles = await db.sql`
    SELECT id, inbox_blob_key, thumbnail_blob_key
    FROM field_photo_submission_files
    WHERE status IN ('approved', 'rejected')
      AND (inbox_blob_key IS NOT NULL OR thumbnail_blob_key IS NOT NULL)
  `;
  await deletePrivatePhotoBlobs(db, store, terminalFiles);

  const submissions = await db.sql`
    SELECT id, status
    FROM field_photo_submissions
    WHERE received_at < NOW() - make_interval(days => ${days}::INTEGER)
      AND (
        status IN ('processing', 'ready', 'partial', 'failed', 'no_photos')
        OR (
          status = 'rejected'
          AND EXISTS (
            SELECT 1
            FROM field_photo_submission_files
            WHERE submission_id = field_photo_submissions.id
              AND (inbox_blob_key IS NOT NULL OR thumbnail_blob_key IS NOT NULL)
          )
        )
      )
  `;
  if (!submissions.length) return;

  const ids = submissions.map((submission) => submission.id);
  const files = await db.sql`
    SELECT inbox_blob_key, thumbnail_blob_key, id
    FROM field_photo_submission_files
    WHERE submission_id = ANY(${ids})
  `;
  await deletePrivatePhotoBlobs(db, store, files);

  await db.sql`
    UPDATE field_photo_submission_files
    SET
      status = 'rejected',
      gps_latitude = NULL,
      gps_longitude = NULL,
      exif_subset = '{}'::JSONB,
      failure_reason = 'Expired before coordinator review.',
      updated_at = NOW()
    WHERE submission_id = ANY(${ids})
      AND status != 'approved'
  `;
  const unreviewedIds = submissions
    .filter((submission) => !['partial', 'rejected'].includes(submission.status))
    .map((submission) => submission.id);
  if (unreviewedIds.length) {
    await db.sql`
      UPDATE field_photo_submissions
      SET
        status = 'rejected',
        failure_reason = 'Expired before coordinator review.',
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE id = ANY(${unreviewedIds})
    `;
    await db.sql`
      INSERT INTO field_photo_submission_events (submission_id, action, details)
      SELECT expired.submission_id, 'expired',
        ${JSON.stringify({ retention_days: days })}::JSONB
      FROM UNNEST(${unreviewedIds}::UUID[]) AS expired(submission_id)
    `;
  }
};
