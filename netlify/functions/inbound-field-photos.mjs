// /api/inbound/field-photos — verified Resend webhook for emailed photos.
// This is a background function: Resend receives a fast 202 while Netlify
// downloads, validates, rewrites, and quarantines attachments for coordinator
// review. Nothing in this path writes to the public field-photos store.
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import { Resend } from 'resend';
import { FIELD_PHOTO_INBOX_STORE, cleanText, json } from './lib/helpers.mjs';
import { MAX_INBOX_IMAGE_BYTES, processFieldPhoto } from './lib/field-photo-processing.mjs';

export const config = {
  path: '/api/inbound/field-photos',
  background: true,
  includedFiles: ['./vendor/heic-decoder/**'],
};

const MAX_ATTACHMENTS = 12;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const RESEND_ATTACHMENT_HOSTS = new Set(['inbound-cdn.resend.com', 'cdn.resend.app']);
const ALLOWED_DECLARED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
]);

function emailAddress(value) {
  if (typeof value !== 'string') return null;
  const bracketed = value.match(/<([^<>]+)>\s*$/);
  const candidate = (bracketed ? bracketed[1] : value).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function senderDetails(value) {
  const address = emailAddress(value);
  if (!address) return null;
  const bracketed = value.match(/^\s*(.*?)\s*<[^<>]+>\s*$/);
  const name = bracketed ? cleanText(bracketed[1].replace(/^['"]|['"]$/g, ''), 200) : null;
  return { email: address, name };
}

function configuredRecipients() {
  return String(process.env.FIELD_PHOTO_INBOX_RECIPIENTS || '')
    .split(',')
    .map(emailAddress)
    .filter(Boolean);
}

function allowedSenders() {
  return String(process.env.FIELD_PHOTO_ALLOWED_SENDERS || '')
    .split(',')
    .map(emailAddress)
    .filter(Boolean);
}

function matchingRecipient(data, allowed) {
  const delivered = [...(data.to || []), ...(data.received_for || [])]
    .map(emailAddress)
    .filter(Boolean);
  return delivered.find((address) => allowed.includes(address)) || null;
}

function safeFailure(error) {
  return (
    cleanText(error instanceof Error ? error.message : String(error), 500) || 'Processing failed.'
  );
}

async function downloadAttachment(url, expectedBytes) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Resend returned an invalid attachment URL.');
  }
  if (parsed.protocol !== 'https:' || !RESEND_ATTACHMENT_HOSTS.has(parsed.hostname)) {
    // Log only the parsed hostname. The complete signed URL contains temporary
    // credentials and must never be written to function logs.
    console.error(
      'Field photo intake rejected unexpected Resend attachment hostname:',
      parsed.hostname
    );
    throw new Error('Resend returned an unexpected attachment host.');
  }
  if (expectedBytes > MAX_INBOX_IMAGE_BYTES) {
    throw new Error('The attachment is larger than the 15 MB intake limit.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(parsed, { redirect: 'error', signal: controller.signal });
    if (!response.ok) throw new Error(`Attachment download failed (${response.status}).`);
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_INBOX_IMAGE_BYTES) {
      throw new Error('The attachment is larger than the 15 MB intake limit.');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_INBOX_IMAGE_BYTES) {
      throw new Error('The attachment is larger than the 15 MB intake limit.');
    }
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function markFileFailed(db, submissionId, attachment, message) {
  await db.sql`
    INSERT INTO field_photo_submission_files (
      submission_id,
      provider_attachment_id,
      original_filename,
      declared_content_type,
      status,
      failure_reason,
      updated_at
    )
    VALUES (
      ${submissionId},
      ${attachment.id},
      ${cleanText(attachment.filename, 255)},
      ${cleanText(attachment.content_type, 100)},
      'failed',
      ${cleanText(message, 500)},
      NOW()
    )
    ON CONFLICT (submission_id, provider_attachment_id) DO UPDATE SET
      status = CASE
        WHEN field_photo_submission_files.status IN ('approved', 'rejected')
          THEN field_photo_submission_files.status
        ELSE 'failed'
      END,
      failure_reason = EXCLUDED.failure_reason,
      updated_at = NOW()
  `;
}

async function processAttachment({ db, resend, store, submissionId, emailId, attachment }) {
  const declaredType = String(attachment.content_type || '').toLowerCase();
  if (!ALLOWED_DECLARED_TYPES.has(declaredType)) {
    await markFileFailed(
      db,
      submissionId,
      attachment,
      'The attachment is not a supported photo type.'
    );
    return false;
  }

  const rows = await db.sql`
    INSERT INTO field_photo_submission_files (
      submission_id,
      provider_attachment_id,
      original_filename,
      declared_content_type,
      status,
      failure_reason,
      updated_at
    )
    VALUES (
      ${submissionId},
      ${attachment.id},
      ${cleanText(attachment.filename, 255)},
      ${cleanText(declaredType, 100)},
      'processing',
      NULL,
      NOW()
    )
    ON CONFLICT (submission_id, provider_attachment_id) DO UPDATE SET
      status = CASE
        WHEN field_photo_submission_files.status IN ('ready', 'approved', 'rejected')
          THEN field_photo_submission_files.status
        ELSE 'processing'
      END,
      failure_reason = CASE
        WHEN field_photo_submission_files.status IN ('ready', 'approved', 'rejected')
          THEN field_photo_submission_files.failure_reason
        ELSE NULL
      END,
      updated_at = NOW()
    RETURNING id, status
  `;
  const file = rows[0];
  if (!file || ['ready', 'approved', 'rejected'].includes(file.status))
    return file?.status === 'ready';

  try {
    const attachmentResponse = await resend.emails.receiving.attachments.get({
      id: attachment.id,
      emailId,
    });
    if (attachmentResponse.error || !attachmentResponse.data) {
      throw new Error(
        attachmentResponse.error?.message || 'Attachment details could not be retrieved.'
      );
    }
    const details = attachmentResponse.data;
    const buffer = await downloadAttachment(details.download_url, Number(details.size || 0));
    const processed = await processFieldPhoto(buffer, { declaredType });
    const imageKey = `${submissionId}/${file.id}/image.jpg`;
    const thumbnailKey = `${submissionId}/${file.id}/thumbnail.jpg`;

    await store.set(imageKey, processed.image, {
      metadata: { contentType: processed.contentType },
    });
    try {
      await store.set(thumbnailKey, processed.thumbnail, {
        metadata: { contentType: processed.contentType },
      });
    } catch (error) {
      await store.delete(imageKey).catch(() => {});
      throw error;
    }

    await db.sql`
      UPDATE field_photo_submission_files SET
        content_type = ${processed.contentType},
        byte_size = ${processed.byteSize},
        width = ${processed.width},
        height = ${processed.height},
        sha256 = ${processed.sha256},
        inbox_blob_key = ${imageKey},
        thumbnail_blob_key = ${thumbnailKey},
        captured_at_local = ${processed.capturedAtLocal},
        captured_offset_minutes = ${processed.capturedOffsetMinutes},
        captured_date = ${processed.capturedDate},
        gps_latitude = ${processed.gpsLatitude},
        gps_longitude = ${processed.gpsLongitude},
        exif_subset = ${JSON.stringify(processed.exifSubset)}::JSONB,
        status = 'ready',
        failure_reason = NULL,
        updated_at = NOW()
      WHERE id = ${file.id}
    `;
    return true;
  } catch (error) {
    await markFileFailed(db, submissionId, attachment, safeFailure(error));
    return false;
  }
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const apiKey = process.env.RESEND_API_KEY;
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const recipients = configuredRecipients();
  if (!apiKey || !webhookSecret || !recipients.length) {
    console.error('Field photo intake is missing Resend or recipient configuration.');
    throw new Error('Field photo intake is not configured.');
  }

  const payload = await req.text();
  const webhookId = req.headers.get('svix-id');
  const timestamp = req.headers.get('svix-timestamp');
  const signature = req.headers.get('svix-signature');
  if (!webhookId || !timestamp || !signature)
    return json({ error: 'Missing webhook signature.' }, 400);

  const resend = new Resend(apiKey);
  let event;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: { id: webhookId, timestamp, signature },
      webhookSecret,
    });
  } catch {
    return json({ error: 'Invalid webhook signature.' }, 400);
  }
  if (event.type !== 'email.received') return json({ ok: true, ignored: true });

  const recipient = matchingRecipient(event.data, recipients);
  const sender = senderDetails(event.data.from);
  const allowlist = allowedSenders();
  if (!recipient || !sender || (allowlist.length && !allowlist.includes(sender.email))) {
    return json({ ok: true, ignored: true });
  }

  const db = getDatabase();
  const inserted = await db.sql`
    INSERT INTO field_photo_submissions (
      provider_event_id,
      provider_email_id,
      sender_name,
      sender_email,
      recipient,
      subject,
      status,
      received_at
    )
    VALUES (
      ${webhookId},
      ${event.data.email_id},
      ${sender.name},
      ${sender.email},
      ${recipient},
      ${cleanText(event.data.subject, 300)},
      'processing',
      ${event.data.created_at}
    )
    ON CONFLICT DO NOTHING
    RETURNING id, status
  `;
  let submission = inserted[0];
  if (!submission) {
    submission = (
      await db.sql`
        SELECT id, status FROM field_photo_submissions
        WHERE provider_event_id = ${webhookId} OR provider_email_id = ${event.data.email_id}
        LIMIT 1
      `
    )[0];
    if (
      !submission ||
      ['ready', 'partial', 'approved', 'rejected', 'no_photos'].includes(submission.status)
    ) {
      return json({ ok: true, duplicate: true });
    }
    await db.sql`
      UPDATE field_photo_submissions
      SET status = 'processing', failure_reason = NULL, updated_at = NOW()
      WHERE id = ${submission.id}
    `;
  }

  try {
    const emailResponse = await resend.emails.receiving.get(event.data.email_id, {
      html_format: 'cid',
    });
    if (emailResponse.error || !emailResponse.data) {
      throw new Error(emailResponse.error?.message || 'The received email could not be retrieved.');
    }
    const attachments = emailResponse.data.attachments || [];
    if (!attachments.length) {
      await db.sql`
        UPDATE field_photo_submissions SET status = 'no_photos', updated_at = NOW()
        WHERE id = ${submission.id}
      `;
      return json({ ok: true, photos: 0 });
    }
    if (attachments.length > MAX_ATTACHMENTS) {
      throw new Error(`The email contains more than ${MAX_ATTACHMENTS} attachments.`);
    }
    const totalBytes = attachments.reduce(
      (sum, attachment) => sum + Number(attachment.size || 0),
      0
    );
    if (totalBytes > MAX_TOTAL_BYTES)
      throw new Error('The email attachments exceed the 40 MB intake limit.');

    const store = getStore(FIELD_PHOTO_INBOX_STORE);
    let ready = 0;
    for (const attachment of attachments) {
      if (
        await processAttachment({
          db,
          resend,
          store,
          submissionId: submission.id,
          emailId: event.data.email_id,
          attachment,
        })
      ) {
        ready += 1;
      }
    }

    const status = ready === attachments.length ? 'ready' : ready > 0 ? 'partial' : 'failed';
    const failure = status === 'failed' ? 'No supported photos could be processed.' : null;
    await db.sql`
      UPDATE field_photo_submissions
      SET status = ${status}, failure_reason = ${failure}, updated_at = NOW()
      WHERE id = ${submission.id}
    `;
    await db.sql`
      INSERT INTO field_photo_submission_events (submission_id, action, details)
      VALUES (
        ${submission.id},
        'processed',
        ${JSON.stringify({ attachments: attachments.length, ready, status })}::JSONB
      )
    `;
    return json({ ok: true, photos: ready });
  } catch (error) {
    const failure = safeFailure(error);
    await db.sql`
      UPDATE field_photo_submissions
      SET status = 'failed', failure_reason = ${failure}, updated_at = NOW()
      WHERE id = ${submission.id}
    `;
    console.error('Field photo intake failed:', submission.id, failure);
    throw error;
  }
};
