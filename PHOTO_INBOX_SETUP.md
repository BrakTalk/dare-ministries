# Field Photo Inbox setup

The application side of the emailed-photo workflow is included in this repository. A coordinator can review emailed photos in `/roster` → **Photo Inbox**, correct EXIF-derived values, and attach selected photos to a Field Note.

## 1. Configure inbound email in Resend

Use **`photos@inbound.whofixedtheroof.com`**. Configure `inbound.whofixedtheroof.com` as the receiving subdomain in Resend; do not replace the root domain's normal mail MX records. A Resend-provided receiving address can be used temporarily while the DNS record is being established.

In Resend:

1. Enable inbound receiving for the chosen domain or address.
2. Create a webhook subscribed to `email.received`.
3. Set its endpoint to `https://YOUR_SITE/api/inbound/field-photos`.
4. Copy the webhook signing secret. The endpoint rejects messages whose Svix signature, timestamp, recipient, or event type is invalid.

References: [Resend Receiving](https://resend.com/docs/dashboard/receiving/introduction), [Resend Webhooks](https://resend.com/docs/dashboard/webhooks/introduction).

## 2. Set Netlify environment variables

Set these variables for the Functions runtime, then redeploy:

| Variable                           | Required | Purpose                                                                                                                   |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`                   | Yes      | Retrieves the verified inbound email and its attachments. It can also continue serving the site's outbound notifications. |
| `RESEND_WEBHOOK_SECRET`            | Yes      | Verifies the raw Resend/Svix webhook payload.                                                                             |
| `FIELD_PHOTO_INBOX_RECIPIENTS`     | Yes      | Comma-separated exact addresses allowed to feed the inbox.                                                                |
| `FIELD_PHOTO_ALLOWED_SENDERS`      | No       | Comma-separated exact sender allowlist. If unset, unknown senders still land only in the private moderation queue.        |
| `FIELD_PHOTO_INBOX_RETENTION_DAYS` | No       | Days before unreviewed private photos and precise GPS are purged. Default: `30`; allowed: `1`–`365`.                      |
| `FIELD_PHOTO_HEIC_ENABLED`         | No       | Fail-closed rollout flag for HEIC/HEIF. Leave unset or `false` until the deploy-preview verification below passes.        |

See `.env.example` for safe placeholders. Never commit real API keys or webhook secrets.

## 3. Deploy and verify

Netlify applies the database migration on deploy. After deployment:

1. Email one JPEG from a phone to the configured address.
2. Open `/roster` as a coordinator and select **Photo Inbox**.
3. Confirm the message shows a thumbnail and, when present, an EXIF capture date and approximate coordinate group.
4. Add a human-readable public location label, choose a Field Note, and approve the photo.
5. Open that Field Note and confirm the approved photo appears in its photo strip.
6. Reject a second test email and confirm it disappears from the open queue.

### Enable HEIC after deploy-preview verification

HEIC support must not be enabled merely because a MIME type is accepted. For each decoder update:

1. Run `npm run verify:heic-artifacts` and the complete test/build suite.
2. Open the deploy preview's `/api/internal/heic-decoder-health` endpoint. It exists only in the `deploy-preview` context and decodes a bundled synthetic HEIC through the packaged executable. Require `ok: true`, decoder `libheif 1.23.1 + libde265 1.1.1`, width `160`, and height `120`.
3. Email a normal iPhone HEIC to a non-production preview inbox when preview-scoped Resend credentials are available. Confirm only clean JPEG derivatives appear in the coordinator inbox.
4. Set `FIELD_PHOTO_HEIC_ENABLED=true` for the intended Netlify deploy context and redeploy. Do not set the variable globally if only a preview has been verified.
5. On any packaged-decoder or runtime failure, set the flag back to `false` and redeploy. JPEG, PNG, WebP, and AVIF intake remains available.

## Processing and security behavior

- Intake is a Netlify background function so Resend receives a prompt acknowledgement while image work continues.
- Provider event and email IDs are unique, making webhook replays idempotent.
- The intake accepts at most 12 supported image attachments, 15 MB per attachment, and 40 MB total per message.
- JPEG, PNG, WebP, and AVIF inputs are decoded with pixel and animation limits. When the rollout flag is enabled, HEVC-backed HEIC/HEIF still images are decoded by the packaged libheif 1.23.1/libde265 1.1.1 runtime. Declared MIME type and filename are never trusted on their own; container signatures are inspected first.
- HEIC decoding selects the primary still, applies HEIF rotation/mirroring, converts bounded HDR input to 8-bit RGB, and passes that raster through the same Sharp pipeline. Timed sequences, videos, multiple top-level images, corrupt containers, and layered HEIF brands are rejected.
- The decoder keeps libheif security limits and strict warning handling enabled, checks dimensions before raster decode, uses at most two codec threads, caps decoder memory, and is killed after 10 seconds. Attachments are processed sequentially and a failed attachment does not stop later valid attachments.
- Every accepted image is auto-oriented, resized to at most 2000 pixels, and re-encoded as JPEG. The public derivative contains no source EXIF or embedded payload.
- Pending images use a private Netlify Blobs store and are served only through the coordinator-authorized admin endpoint with `no-store` caching.
- EXIF capture date, timezone offset, source orientation, and GPS are allowlisted and normalized. Coordinates are available only inside the private queue and are never copied into the public photo record.
- The coordinator chooses the date and a public location label. Those values are stored with the approved Field Note photo for grouping and future presentation.
- Rejecting an email deletes its private images and scrubs precise GPS. A daily scheduled function does the same for abandoned submissions after the retention window.
- Approval and rejection actions are recorded in the photo-submission audit table.

## Operational notes

- Start without `FIELD_PHOTO_ALLOWED_SENDERS` if contributors change frequently; the private approval step remains mandatory. Add an allowlist if spam becomes a problem.
- Ask contributors for consent before publishing identifiable people, especially minors or disaster survivors. EXIF location is a convenience signal, not proof of where or when a photo was taken.
- Attachment processing failures remain visible to coordinators. After fixing a transient provider issue, replay the original webhook from Resend; idempotent processing prevents a duplicate submission.
- Apple Adaptive HDR gain-map compositing is not currently implemented. The primary still is accepted when otherwise supported; auxiliary gain maps are not blended. Non-HEVC HEIF, timed sequences/video, layered formats, and multi-image collections remain unsupported.
- Decoder artifacts, build provenance, deployment constraints, security controls, and licensing notes are maintained in `HEIC_DECODER.md` and `netlify/functions/vendor/heic-decoder/`.
