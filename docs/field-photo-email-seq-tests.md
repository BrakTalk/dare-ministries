# System model inferred from diagram

The flow begins at an untrusted contributor email and crosses the Resend webhook boundary into a Netlify background function. `inbound-field-photos` authenticates the raw webhook, restricts delivery to configured recipient addresses, optionally restricts senders, creates an idempotent submission, retrieves attachment metadata from Resend, downloads only from the expected Resend CDN, and hands each attachment to `processFieldPhoto`.

`processFieldPhoto` treats filenames and declared MIME types as hints, inspects the bytes, enforces byte/pixel/page limits, extracts an allowlisted EXIF subset, normalizes capture date/time and GPS, auto-orients supported inputs, and emits stripped JPEG image and thumbnail derivatives. The current inbox PR supports JPEG, PNG, WebP, and AVIF; HEIC/HEIF intake is planned as a separate follow-up.

The inbound handler stores derivatives in the private `field-photo-inbox` Blob store and records file/submission state plus normalized metadata in the database. Submission states move through `processing` to `ready`, `partial`, `failed`, or `no_photos`; terminal webhook replays are acknowledged without repeating work.

An authenticated active coordinator uses `admin-field-photo-inbox` to list submissions, stream private previews, correct metadata, reject a submission, or approve selected files. Approval copies only sanitized JPEG derivatives into the public `field-photos` store, creates `field_note_photos` rows, clears precise GPS/EXIF from approved inbox rows, records an audit event, and triggers a rebuild when the target Field Note is already published. Rejection deletes private derivatives and scrubs precise location metadata.

External side effects are Resend API calls, CDN downloads, database writes, private/public Blob writes and deletes, audit events, application logs, and an optional Netlify build-hook request. The contributor-visible outcome is only webhook acceptance; the coordinator-visible outcome is a moderated private queue; the public outcome is limited to explicitly approved Field Note photos.

# Assumptions and ambiguities

- The supplied diagram represents the email-inbox implementation in PR #16. In-progress HEIC/HEIF work on a separate branch is intentionally outside this PR's acceptance criteria.
- With `FIELD_PHOTO_ALLOWED_SENDERS` unset, anyone who knows the address may submit, but nothing becomes public without coordinator approval. When configured, the allowlist is exact and case-normalized.
- Direct handler tests receive the handler's JSON response even though Netlify deploys intake as a background function. Provider acknowledgement timing and Netlify's outer `202` behavior require a deployed integration test.
- Provider event ID and provider email ID uniqueness are the authoritative replay controls. The tests cover completed replay behavior; simultaneous first delivery of the same event still needs a database-backed concurrency test.
- Attachment `size` values are untrusted hints. The implementation checks provider metadata, HTTP `Content-Length`, and downloaded body length; a deployed test should also exercise an interrupted/chunked response and the 20-second timeout.
- A message-level limit failure marks the submission failed and rethrows so the platform can observe/retry the background failure. This contract should be confirmed against Resend's retry policy.
- Approval currently performs several database and Blob operations without a single cross-system transaction. The intended behavior for two coordinators approving the same file at the same time is not specified; row locking or an atomic status transition should be defined before adding a deterministic race test.
- The final public record intentionally excludes precise GPS. The coordinator-supplied location label and capture date are the only grouping attributes promoted to Field Notes.
- Consent, identifiable-person handling, and minors' images are moderation policy concerns outside automated code tests and should be documented for coordinators.

# Test cases by phase

## Phase: Webhook authentication and admission

### FP-IN-01 - Reject unsupported HTTP methods before initialization
- Category: API contract
- Priority: P1
- Type: Negative
- Preconditions: Intake configuration may be absent.
- Steps: Send a `GET` request to the inbound endpoint.
- Expected results: Return HTTP 405 with a stable JSON error; do not construct Resend, query the database, download data, or access Blob stores.
- Defect(s) this could expose: Side effects on probes, confusing provider errors, unnecessary secret/config coupling.
- Notes: Method validation should remain the first gate.

### FP-IN-02 - Fail closed when intake configuration is incomplete
- Category: Configuration
- Priority: P0
- Type: Negative / Observability
- Preconditions: One or more of API key, webhook secret, or configured recipients is absent.
- Steps: Submit an otherwise well-formed signed-webhook-shaped POST.
- Expected results: Return HTTP 503, write a generic configuration diagnostic, and perform no signature verification, database, network, or Blob operations.
- Defect(s) this could expose: Accepting unverifiable mail, secret leakage, partially initialized processing.
- Notes: Logs must not print secret values.

### FP-IN-03 - Reject missing signature headers
- Category: Webhook security
- Priority: P0
- Type: Security / Negative
- Preconditions: Intake is configured.
- Steps: POST without one or more `svix-id`, `svix-timestamp`, and `svix-signature` headers.
- Expected results: Return HTTP 400 before Resend verification, database access, email retrieval, or Blob writes.
- Defect(s) this could expose: Unsigned webhook acceptance and resource-exhaustion entry points.
- Notes: Cryptographically invalid signatures are already covered by the existing flow suite.

### FP-IN-04 - Enforce the optional sender allowlist without exposing policy
- Category: Admission policy
- Priority: P1
- Type: Security / Negative
- Preconditions: `FIELD_PHOTO_ALLOWED_SENDERS` contains a different sender.
- Steps: Verify a legitimate Resend event addressed to the correct inbox from a non-allowlisted sender.
- Expected results: Return the same HTTP 200 ignored response used for other non-admitted events; create no submission and retrieve no email.
- Defect(s) this could expose: Allowlist bypass, account enumeration, unnecessary storage of rejected senders.
- Notes: Address comparison is lowercased and exact.

### FP-IN-05 - Treat a terminal webhook replay as an idempotent no-op
- Category: Replay handling
- Priority: P0
- Type: Edge / Concurrency
- Preconditions: A submission with the same provider event or email ID is already `ready`.
- Steps: Deliver the signed webhook again after the insert conflicts.
- Expected results: Return HTTP 200 with `duplicate: true`; do not retrieve the email, download attachments, rewrite images, or write Blobs.
- Defect(s) this could expose: Duplicate photos, repeated provider cost, replay-driven resource exhaustion.
- Notes: Simultaneous first-delivery behavior remains an integration-test gap.

## Phase: Email and attachment acquisition

### FP-ACQ-01 - Close an email with no attachments as no photos
- Category: State transition
- Priority: P1
- Type: Edge
- Preconditions: The verified email exists but has an empty attachment list.
- Steps: Process the event.
- Expected results: Set the submission to `no_photos`, return HTTP 200 with `photos: 0`, and avoid all Blob and image-processing calls.
- Defect(s) this could expose: Submissions stuck in `processing`, empty work sent to decoders.
- Notes: Inline body images are attachments only when Resend reports them as such.

### FP-ACQ-02 - Reject more than twelve attachments before file processing
- Category: Resource limits
- Priority: P0
- Type: Negative / Security
- Preconditions: The received email reports 13 attachments.
- Steps: Process the event.
- Expected results: Mark the submission failed with a bounded reason, log the submission ID and reason, perform no attachment-detail lookup or Blob access, and propagate the background failure.
- Defect(s) this could expose: Fan-out denial of service, silent background failure, unbounded logs.
- Notes: Resend's outer webhook acknowledgement is deployment-owned.

### FP-ACQ-03 - Reject a message whose declared attachment total exceeds 40 MB
- Category: Resource limits
- Priority: P0
- Type: Negative / Security
- Preconditions: Twelve or fewer attachments collectively report more than 40 MB.
- Steps: Process the event.
- Expected results: Mark the submission failed before individual downloads or Blob access and propagate the background failure.
- Defect(s) this could expose: Memory exhaustion and bypass of aggregate limits.
- Notes: Individual byte limits are enforced separately.

### FP-ACQ-04 - Refuse attachment downloads from an unexpected host
- Category: Network trust boundary
- Priority: P0
- Type: Security
- Preconditions: Resend attachment metadata contains an HTTPS URL outside `inbound-cdn.resend.com`.
- Steps: Process the attachment.
- Expected results: Do not call `fetch`; record the file as failed with a safe reason; finish the submission as failed with zero ready photos.
- Defect(s) this could expose: SSRF, signed-URL exfiltration, arbitrary network access.
- Notes: Redirects are also disabled by the downloader.

### FP-ACQ-05 - Reject an oversized attachment from provider metadata before download
- Category: Resource limits
- Priority: P0
- Type: Negative / Security
- Preconditions: Attachment details report more than 15 MB.
- Steps: Process the attachment.
- Expected results: Do not fetch the URL or invoke the image processor; record a bounded per-file failure and return zero ready photos.
- Defect(s) this could expose: Oversized allocation and provider-metadata limit bypass.
- Notes: Existing implementation also checks HTTP and actual body size.

## Phase: Image normalization and private storage

### FP-PROC-01 - Reject a currently unsupported declared image type before download
- Category: Format admission
- Priority: P0
- Type: Negative
- Preconditions: A verified attachment uses a declared type outside the current JPEG/PNG/WebP/AVIF contract, including HEIC until the follow-up PR lands.
- Steps: Process the attachment list.
- Expected results: Do not retrieve or download the attachment; record a bounded per-file unsupported-type failure and return zero ready photos.
- Defect(s) this could expose: Unsafe decoder reachability, wasted provider calls, a format being partially accepted without an end-to-end decoder path.
- Notes: The HEIC follow-up must replace this expectation with guarded decoder success/failure coverage.

### FP-PROC-02 - Preserve successful files when another attachment fails
- Category: Partial failure
- Priority: P0
- Type: Negative / Recovery
- Preconditions: A two-attachment email has one valid photo and one attachment that fails admission or processing.
- Steps: Process both attachments in order.
- Expected results: Store only the successful derivatives, mark the failed file failed, set submission state to `partial`, return `photos: 1`, and audit attachment/ready/status counts.
- Defect(s) this could expose: All-or-nothing message loss, incorrect ready count, missing audit evidence.
- Notes: Processing is intentionally sequential to bound resource use.

### FP-PROC-03 - Roll back the full-size private derivative when thumbnail storage fails
- Category: Blob compensation
- Priority: P0
- Type: Negative / Recovery
- Preconditions: Full-size private Blob write succeeds; thumbnail write fails.
- Steps: Process one otherwise valid attachment.
- Expected results: Delete the full-size private Blob, mark the file failed, leave no ready database row, and return zero ready photos.
- Defect(s) this could expose: Orphaned private content, ready rows with incomplete previews.
- Notes: Delete failure is best-effort and retention remains the secondary cleanup path.

### FP-PROC-04 - Resume a replay without redownloading an already-ready attachment
- Category: File idempotency
- Priority: P1
- Type: Edge / Concurrency
- Preconditions: The submission is reprocessing but its attachment row is already `ready`.
- Steps: Process the attachment again.
- Expected results: Count it as ready without attachment-detail lookup, download, processor invocation, or Blob writes.
- Defect(s) this could expose: Duplicate work and accidental replacement of reviewed derivatives.
- Notes: Approved and rejected rows remain terminal and are not overwritten by the upsert.

## Phase: Coordinator private inbox and previews

### FP-ADM-01 - Reject malformed preview identifiers before private storage access
- Category: Input validation
- Priority: P0
- Type: Security / Negative
- Preconditions: Coordinator session is valid.
- Steps: Request a preview with a non-UUID `file_id`.
- Expected results: Return HTTP 404 and do not query the file row or read the private Blob store.
- Defect(s) this could expose: Path/key injection and identifier probing.
- Notes: The same endpoint defaults unknown variants to thumbnail.

### FP-ADM-02 - Serve authorized previews with private, non-sniffable headers
- Category: Content privacy
- Priority: P0
- Type: Security / Positive
- Preconditions: Coordinator is authorized and a ready file points to an existing private Blob.
- Steps: Request the full image variant.
- Expected results: Return the Blob bytes with `Content-Type`, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`.
- Defect(s) this could expose: Browser/proxy caching of private photos, content-type confusion.
- Notes: Coordinator denial before lookup is covered by the existing suite.

### FP-ADM-03 - Block cross-origin mutations before parsing or database writes
- Category: CSRF protection
- Priority: P0
- Type: Security / Negative
- Preconditions: Coordinator session is valid but `requireSameOrigin` rejects the request.
- Steps: POST an otherwise valid approval request.
- Expected results: Return the origin denial response exactly; perform no domain SQL or Blob operation.
- Defect(s) this could expose: CSRF approval/rejection and unnecessary attacker-controlled parsing.
- Notes: Authentication and origin checks are independent gates.

### FP-ADM-04 - Reject malformed JSON without state mutation
- Category: Request contract
- Priority: P1
- Type: Negative
- Preconditions: Coordinator and origin are valid.
- Steps: POST syntactically invalid JSON.
- Expected results: Return HTTP 400 and perform no SQL or Blob operation.
- Defect(s) this could expose: Unhandled parser exceptions or partial writes.
- Notes: Oversized-body enforcement is platform configuration and should be verified separately.

## Phase: Approval and publication

### FP-ADM-05 - Reject approval to a nonexistent Field Note
- Category: Referential integrity
- Priority: P0
- Type: Negative
- Preconditions: Request identifiers are valid but the note lookup returns no row.
- Steps: Submit approval.
- Expected results: Return HTTP 404 before reading private Blobs or writing public photos.
- Defect(s) this could expose: Orphaned public Blobs and photos referencing absent notes.
- Notes: Database foreign keys remain the final safeguard.

### FP-ADM-06 - Reject a selection containing unavailable files as one batch
- Category: State integrity
- Priority: P0
- Type: Negative / Concurrency
- Preconditions: At least one requested file is no longer `ready` or does not belong to the submission.
- Steps: Submit approval.
- Expected results: Return HTTP 409 before reading/copying any Blob or inserting any public photo.
- Defect(s) this could expose: Cross-submission approval, stale-selection partial publication.
- Notes: This is the optimistic concurrency check before copy.

### FP-ADM-07 - Reject approval when the private derivative has disappeared
- Category: Blob consistency
- Priority: P0
- Type: Negative / Recovery
- Preconditions: Database file row is ready but its private image Blob is missing.
- Steps: Submit approval.
- Expected results: Return HTTP 409, write no public Blob, and create no public photo row.
- Defect(s) this could expose: Broken Field Note photo references and false success.
- Notes: Retention or manual cleanup can create this state.

### FP-ADM-08 - Remove a copied public Blob when its database insert fails
- Category: Cross-system compensation
- Priority: P0
- Type: Negative / Recovery
- Preconditions: Private read and public Blob write succeed; `field_note_photos` insert throws.
- Steps: Submit approval.
- Expected results: Reject the request and delete the newly copied public Blob; do not report approval success.
- Defect(s) this could expose: Orphaned public content and untracked publication.
- Notes: The database/Blob boundary cannot be covered by a single transaction.

### FP-ADM-09 - Keep private keys for retention retry when post-approval deletion fails
- Category: Cleanup recovery
- Priority: P1
- Type: Edge / Recovery
- Preconditions: Public publication succeeds but one or both private deletes reject.
- Steps: Complete approval.
- Expected results: Return success, retain inbox Blob keys in the file row, scrub precise GPS/EXIF, and allow scheduled retention to retry deletion.
- Defect(s) this could expose: Lost cleanup references or failed user-visible approval after durable publication.
- Notes: Private previews should no longer list the approved item even while keys remain.

### FP-ADM-10 - Reject a submission by deleting private derivatives and scrubbing precise location
- Category: Moderation cleanup
- Priority: P0
- Type: Positive / Security
- Preconditions: Open submission has unapproved files with private image and thumbnail keys.
- Steps: Submit the reject action.
- Expected results: Attempt every private deletion, mark non-approved files rejected, null Blob keys and GPS coordinates, clear EXIF subset, close the submission, and insert an actor-attributed audit event.
- Defect(s) this could expose: Privacy retention after rejection, incomplete audit trail.
- Notes: Blob deletes are best-effort so database privacy scrubbing must still execute.

### FP-ADM-11 - Trigger a rebuild after approving into a published Field Note
- Category: Publication propagation
- Priority: P1
- Type: Positive / Observability
- Preconditions: Target Field Note status is `published` and a build hook is configured.
- Steps: Approve one ready photo.
- Expected results: Complete durable Blob/database publication, then POST the build hook; return approval success even if the hook is fire-and-forget.
- Defect(s) this could expose: Approved photo absent from the static site until an unrelated deploy.
- Notes: Build-hook failure logging is covered by the helper's own contract.

# Cross-cutting security, resilience, and concurrency tests

## FP-X-01 - Reject duplicate file IDs in one approval selection
- Category: Replay and selection integrity
- Priority: P1
- Type: Edge / Concurrency
- Preconditions: Request repeats the same valid ready file ID twice.
- Steps: Submit approval with both entries.
- Expected results: Return HTTP 409 because the unique ready-row count does not match the requested selection count; perform no Blob copy or public insert.
- Defect(s) this could expose: Duplicate public photos, conflicting cover/metadata choices, inflated approval counts.
- Notes: A clearer HTTP 400 duplicate-specific response could be considered later.

The implementation still needs deployed or database-backed tests for simultaneous webhook delivery, simultaneous coordinator approval, request timeout/cancellation, CDN streaming interruption, and provider/platform retry timing. Those scenarios cannot be faithfully proven with the in-process mocks used here.

# Observability and logging assertions

- Configuration failures emit a generic message without API keys, webhook secrets, signatures, or payloads.
- Message-level intake failures log the internal submission ID plus a bounded failure reason, not attachment bytes or email bodies.
- Per-file failures remain visible through file status and `failure_reason`; successful/partial processing writes a `processed` event containing only counts and status.
- Metadata updates, approvals, rejections, and expirations record actor/action details appropriate to audit review.
- Preview responses are explicitly `no-store`; JSON list/mutation responses also avoid caching through the admin handler.
- Metrics are not currently emitted for intake count, rejected signatures, processing latency, decoder failure, Blob compensation, or queue age. Add bounded-cardinality counters before operational rollout.

# Existing coverage intentionally not duplicated

- `netlify/functions/__tests__/field-photo-inbox-flow.test.ts` already covers invalid signatures, wrong recipients, the JPEG success path, derivative/EXIF persistence, current HEIC rejection, coordinator denial, list grouping, whole-batch metadata validation, selected-photo promotion, GPS exclusion from public records, and retention cleanup/concurrency.
- `netlify/functions/__tests__/field-photo-processing.test.ts` already covers EXIF date/offset/GPS normalization, impossible metadata, bounded JPEG re-encoding, source metadata stripping, thumbnail dimensions, and empty-input rejection.
- `src/js/__tests__/photo-inbox.test.ts` already covers coordinator grouping UI, edited metadata payloads, selected approval payloads, and rejection payloads.

# Code review risk checklist

- Verify raw webhook verification always precedes parsing-derived trust, database writes, and provider retrieval.
- Keep the exact recipient gate and optional sender allowlist case-normalized; do not trust only the visible `To` header.
- Preserve provider event/email uniqueness and file upsert terminal-state guards during retries.
- Keep attachment URLs restricted to HTTPS on the exact Resend CDN hostname with redirects disabled.
- Enforce attachment count, per-file bytes, aggregate bytes, decoded pixels, and page/animation limits independently.
- Treat declared MIME type, filename, EXIF, sender name, subject, and provider error text as untrusted.
- Publish only re-encoded JPEG derivatives; never copy original email bytes or precise GPS into Field Notes.
- Preserve `private, no-store` and `nosniff` on coordinator previews, with authorization before lookup.
- Require same-origin checks on every mutation and validate the full selection before the first write.
- Review the approval race: two coordinators can select the same `ready` row before either updates it unless locking or an atomic claim is added.
- Review mid-batch approval failure: cross-system operations are compensated per file but are not atomic across the entire selection.
- Retain Blob keys when cleanup fails so scheduled retention can retry, while immediately scrubbing GPS/EXIF after approval or rejection.
- Ensure logs and audit details never include webhook signatures, API keys, signed CDN URLs, image bytes, or raw EXIF payloads.
