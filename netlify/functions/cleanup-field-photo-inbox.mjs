// Daily cleanup for abandoned Photo Inbox submissions. Approved/rejected rows
// remain as an audit trail, but private blobs and exact EXIF location data do
// not outlive the configured review window.
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import { deleteBlobKeys } from './lib/blob-deletion.mjs';
import { FIELD_PHOTO_INBOX_STORE } from './lib/helpers.mjs';

export const config = { schedule: '@daily' };

function retentionDays() {
  const configured = Number(process.env.FIELD_PHOTO_INBOX_RETENTION_DAYS || 30);
  return Number.isInteger(configured) && configured >= 1 && configured <= 365 ? configured : 30;
}

export default async () => {
  const db = getDatabase();
  const days = retentionDays();
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
    SELECT inbox_blob_key, thumbnail_blob_key
    FROM field_photo_submission_files
    WHERE submission_id = ANY(${ids})
  `;
  const store = getStore(FIELD_PHOTO_INBOX_STORE);
  const keys = files
    .flatMap((file) => [file.inbox_blob_key, file.thumbnail_blob_key])
    .filter(Boolean);
  const deletedKeys = await deleteBlobKeys(store, keys);
  const deletedInboxKeys = files
    .map((file) => file.inbox_blob_key)
    .filter((key) => key && deletedKeys.has(key));
  const deletedThumbnailKeys = files
    .map((file) => file.thumbnail_blob_key)
    .filter((key) => key && deletedKeys.has(key));

  if (deletedInboxKeys.length) {
    await db.sql`
      UPDATE field_photo_submission_files
      SET inbox_blob_key = NULL, updated_at = NOW()
      WHERE submission_id = ANY(${ids})
        AND inbox_blob_key = ANY(${deletedInboxKeys})
    `;
  }
  if (deletedThumbnailKeys.length) {
    await db.sql`
      UPDATE field_photo_submission_files
      SET thumbnail_blob_key = NULL, updated_at = NOW()
      WHERE submission_id = ANY(${ids})
        AND thumbnail_blob_key = ANY(${deletedThumbnailKeys})
    `;
  }

  await db.sql`
    UPDATE field_photo_submission_files
    SET
      status = CASE WHEN status = 'approved' THEN status ELSE 'rejected' END,
      gps_latitude = NULL,
      gps_longitude = NULL,
      exif_subset = '{}'::JSONB,
      failure_reason = CASE
        WHEN status = 'approved' THEN failure_reason
        ELSE 'Expired before coordinator review.'
      END,
      updated_at = NOW()
    WHERE submission_id = ANY(${ids})
  `;
  const newlyExpiredIds = submissions
    .filter((submission) => submission.status !== 'rejected')
    .map((submission) => submission.id);
  if (newlyExpiredIds.length) {
    await db.sql`
      UPDATE field_photo_submissions
      SET
        status = 'rejected',
        failure_reason = 'Expired before coordinator review.',
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE id = ANY(${newlyExpiredIds})
    `;
    await db.sql`
      INSERT INTO field_photo_submission_events (submission_id, action, details)
      SELECT expired.submission_id, 'expired',
        ${JSON.stringify({ retention_days: days })}::JSONB
      FROM UNNEST(${newlyExpiredIds}::UUID[]) AS expired(submission_id)
    `;
  }
};
