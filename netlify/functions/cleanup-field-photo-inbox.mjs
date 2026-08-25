// Daily cleanup for abandoned Photo Inbox submissions. Approved/rejected rows
// remain as an audit trail, but private blobs and exact EXIF location data do
// not outlive the configured review window.
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import { FIELD_PHOTO_INBOX_STORE } from './lib/helpers.mjs';

export const config = { schedule: '@daily' };
const DELETE_BATCH_SIZE = 25;

function retentionDays() {
  const configured = Number(process.env.FIELD_PHOTO_INBOX_RETENTION_DAYS || 30);
  return Number.isInteger(configured) && configured >= 1 && configured <= 365 ? configured : 30;
}

export default async () => {
  const db = getDatabase();
  const days = retentionDays();
  const submissions = await db.sql`
    SELECT id
    FROM field_photo_submissions
    WHERE status IN ('processing', 'ready', 'partial', 'failed', 'no_photos')
      AND received_at < NOW() - make_interval(days => ${days}::INTEGER)
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
  for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
    await Promise.allSettled(
      keys.slice(index, index + DELETE_BATCH_SIZE).map((key) => store.delete(key))
    );
  }

  await db.sql`
    UPDATE field_photo_submission_files
    SET
      status = CASE WHEN status = 'approved' THEN status ELSE 'rejected' END,
      inbox_blob_key = NULL,
      thumbnail_blob_key = NULL,
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
  await db.sql`
    UPDATE field_photo_submissions
    SET
      status = 'rejected',
      failure_reason = 'Expired before coordinator review.',
      reviewed_at = NOW(),
      updated_at = NOW()
    WHERE id = ANY(${ids})
  `;
  await db.sql`
    INSERT INTO field_photo_submission_events (submission_id, action, details)
    SELECT expired.submission_id, 'expired',
      ${JSON.stringify({ retention_days: days })}::JSONB
    FROM UNNEST(${ids}::UUID[]) AS expired(submission_id)
  `;
};
