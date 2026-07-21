# Field Notes ("From the Field") — Sequence-Derived Test Suite

Generated from the publish-flow sequence diagram (Admin → RosterConsole → AdminFieldNotes / AdminFieldNotePhotos → NetlifyDatabase / NetlifyBlobs → EleventyBuild).

# System model inferred from diagram

**Participants / real modules:**

| Diagram participant | Implementation |
|---|---|
| Admin | Human with the shared admin password (session cookie) |
| RosterConsole | `src/roster.njk` + `src/js/roster.js` (browser) |
| AdminFieldNotes | `netlify/functions/admin-field-notes.mjs` (`/api/admin/field-notes`) |
| AdminFieldNotePhotos | `netlify/functions/admin-field-note-photos.mjs` (`/api/admin/field-note-photos`) |
| NetlifyDatabase | Postgres via `@netlify/database` (`field_notes`, `field_note_photos`) |
| NetlifyBlobs | Store `field-photos`, key `<note_id>/<photo_id>` |
| EleventyBuild | `src/_data/fieldNotes.js` (build-time fetch) + `src/field-note*.njk` + `markdown` filter in `.eleventy.js` |

**Key state transitions:** note `draft ⇄ published` (publish sets `published_at` once via COALESCE; slug frozen after first publish). Photo lifecycle: DB row + blob created together (DB-first with rollback on blob failure); deleted DB-row-first.

**Async / trust boundaries:** browser → functions (cookie auth, `requireAuth` first); functions → build hook (`BUILD_HOOK_URL`, fire-and-forget); build → DB (read-only, `status = 'published'` gate is the only draft/public boundary).

**External side effects:** Postgres rows, blobs, Netlify build-hook POSTs, static pages emitted at build.

**Non-obvious contracts under test:** slug uniqueness with `-2` retry; `isUuid` guards before any query; 5 MB body cap under Netlify's ~6 MB limit; content-type allowlist; atomic cover swap (`SET is_cover = (id = X)` in one statement); build failure on DB error (never ship an empty archive over a populated one); markdown rendered with `html: false`; photo serving checks the metadata row and parent-note status — published photos are public/immutable, draft photos require an admin session (`no-store`), and orphaned blobs are never served.

# Assumptions and ambiguities

- **Assumed** `db.sql` tagged templates parameterize all interpolations (SQL injection out of scope for unit tests; covered by library contract).
- **Assumed** the build hook may fire multiple times in quick succession; Netlify queues/supersedes builds, so no debounce is required or tested.
- **Ambiguity:** the diagram shows one "upload photo" arrow; the implementation also supports PATCH (caption/cover/order) and DELETE — treated as part of the photo phase.
- **Ambiguity:** the diagram does not show public image serving; `field-photo.mjs` is the read path for generated pages, so it is included.
- **Ambiguity:** concurrent editing of the same note by two admins is last-write-wins by design (no optimistic locking). Documented, not "fixed" by tests.
- **Accepted trade-off:** blob-delete failure after row delete leaves an orphaned blob (M4). Orphans are *unserveable* — the serving function 404s any blob without a metadata row (S7) — so the residual cost is storage only. The one true residual exposure is CDN edge caches: a published photo cached `immutable` may keep serving from the edge for up to a year after unpublish/delete. Keys are unguessable double-UUIDs and content is destined-for-public trip photos, so this is accepted rather than engineered away (cache purging would require the Netlify API).
- **Clarifying questions for developers:** should DELETE of a published note require a confirmation token? Should there be a public `GET /api/field-notes` (currently deliberately absent — see B8)?

> **Revision note:** S1–S3 were updated and S5–S7 added after review feedback — the serving
> function now enforces row-existence and note-status checks rather than relying on
> unguessable URLs alone.

# Test cases by phase

## Phase: Note save & publish (`admin-field-notes.mjs`)

### N1 - Create a valid draft
- Category: Contract / happy path — Priority: P0 — Type: Positive
- Preconditions: authenticated; DB accepts insert
- Steps: POST `{title, start_date: 2026-07-16, end_date: 2026-07-18, body}`
- Expected results: 201 `{ok:true, id, slug}`; slug is `2026-07-<slugified-title>`; row inserted with status `draft`
- Defect(s): broken slug generation, wrong status code/shape, notes born published

### N2 - Reject missing title
- Category: Validation — P0 — Negative
- Steps: POST without `title` → Expected: 400 `{error}`; no INSERT executed

### N3 - Reject malformed start_date
- Category: Validation — P0 — Negative
- Steps: POST `start_date: "July 16"` → Expected: 400; no INSERT

### N4 - Reject malformed end_date
- Category: Validation — P1 — Negative
- Steps: POST valid fields + `end_date: "18-07-2026"` → Expected: 400

### N5 - Slug collision retries with numeric suffix
- Category: Data integrity — P1 — Edge
- Preconditions: first INSERT raises a unique violation
- Steps: POST a title whose slug already exists
- Expected: second INSERT attempted with `<slug>-2`; 201 returns the suffixed slug
- Defect(s): infinite retry loop, 500 on duplicate monthly trips with the same title

### N6 - Oversized body is capped, not rejected
- Category: Validation — P2 — Edge
- Steps: POST body > 50,000 chars → Expected: 201; persisted body length ≤ 50,000 (`cleanText` cap)

### N7 - Publish sets published_at and fires the build hook
- Category: State transition — P0 — Positive
- Preconditions: existing draft; `BUILD_HOOK_URL` set
- Steps: PATCH `{id, status:'published'}`
- Expected: UPDATE with status `published` and a fresh `published_at`; exactly one POST to the build hook; 200 `{ok, slug}`

### N8 - Republish keeps the original published_at
- Category: State transition — P1 — Edge
- Preconditions: note with `published_at` already set (was unpublished)
- Steps: PATCH `{id, status:'published'}` → Expected: UPDATE reuses the existing `published_at` (COALESCE semantics)

### N9 - Draft slug follows title changes
- Category: Data integrity — P1 — Edge
- Preconditions: draft, never published (`published_at IS NULL`)
- Steps: PATCH `{id, title: <new>}` → Expected: UPDATE carries a regenerated slug

### N10 - Slug frozen once ever published
- Category: Data integrity — P0 — Edge
- Preconditions: note with `published_at` set (even if currently draft)
- Steps: PATCH `{id, title: <new>}` → Expected: UPDATE keeps the original slug (shared URLs never break)

### N11 - Draft re-slug avoids collisions
- Category: Data integrity — P2 — Edge
- Preconditions: another note already owns the regenerated slug
- Steps: PATCH title change → Expected: `-2`-suffixed slug used

### N12 - Reject invalid status value
- Category: Validation — P1 — Negative
- Steps: PATCH `{id, status:'archived'}` → Expected: 400; no UPDATE

### N13 - Reject non-UUID id before touching the DB
- Category: Validation — P0 — Negative
- Steps: PATCH `{id: "1 OR 1=1"}` → Expected: 400; **zero** DB calls

### N14 - Unknown id → 404
- Category: Contract — P1 — Negative
- Steps: PATCH with a valid-format UUID that matches no row → Expected: 404 `{error:'Entry not found'}`

### N15 - Draft edit does not fire the build hook
- Category: Side-effect scoping — P1 — Positive
- Steps: PATCH body change on a draft never published → Expected: 200; no hook POST (drafts must not burn builds)

### N16 - Unpublish fires the build hook
- Category: State transition — P0 — Positive
- Steps: PATCH `{id, status:'draft'}` on a published note → Expected: hook fired (stale public page must be rebuilt away)

### N17 - Delete published note removes blobs, row, and rebuilds
- Category: Cleanup — P0 — Positive
- Steps: DELETE `{id}` on a published note with 2 blobs
- Expected: `store.list({prefix: id/})` + `store.delete` per blob; `DELETE FROM field_notes`; hook fired; 200 `{ok}`
- Defect(s): orphaned blobs accumulating per deleted trip; public page surviving deletion

### N18 - Delete draft does not fire the hook
- Category: Side-effect scoping — P2 — Edge

### N19 - Delete unknown id → 404
- Category: Contract — P2 — Negative

### N20 - Unsupported method → 405
- Category: Contract — P2 — Negative
- Steps: PUT → Expected: 405 `{error:'Method not allowed'}`

### N21 - Unauthenticated requests are rejected before any DB access
- Category: Security — P0 — Security
- Steps: GET/POST/PATCH/DELETE with `requireAuth` failing
- Expected: 401 for all; **zero** DB calls (auth is the first statement)
- Defect(s): auth checked after side effects; drafts leaking through admin GET

### N22 - Build-hook failure never fails the request
- Category: Resilience — P1 — Edge
- Preconditions: hook endpoint returns 500 / fetch throws
- Steps: publish a note → Expected: 200 `{ok}`; `console.error` records the hook failure

### N23 - Admin GET returns drafts and published with photos attached
- Category: Contract — P1 — Positive
- Expected: array includes drafts; each note has `photos[]` with `url: /images/field/<note_id>/<photo_id>`

## Phase: Photo upload (`admin-field-note-photos.mjs` POST)

### P1 - Valid JPEG upload
- Category: Happy path — P0 — Positive
- Steps: POST raw bytes, `Content-Type: image/jpeg`, `?note_id=<uuid>`
- Expected: 201 `{ok, id, url}`; DB row inserted; blob written at `<noteId>/<photoId>` with `metadata.contentType`
- Defect(s): key mismatch between writer and server, metadata loss

### P2 - Disallowed content type → 415
- Category: Security/validation — P0 — Negative
- Steps: POST with `Content-Type: text/plain` (e.g. a renamed .txt) → Expected: 415; no DB row, no blob

### P3 - Content-type parameters are tolerated
- Category: Contract — P2 — Edge
- Steps: `Content-Type: image/jpeg; charset=utf-8` → Expected: accepted (params stripped before allowlist check)

### P4 - Empty body → 400
- Category: Validation — P1 — Negative

### P5 - Oversize body → 413, nothing persisted
- Category: Validation — P0 — Negative
- Steps: POST > 5 MB → Expected: 413 with a human-readable error; no INSERT, no blob write (guard must run before persistence)

### P6 - Malformed note_id → 400 before DB
- Category: Validation — P0 — Negative

### P7 - Unknown note_id → 404
- Category: Contract — P1 — Negative

### P8 - Blob write failure rolls back the metadata row
- Category: Partial failure — P0 — Negative
- Preconditions: `store.set` rejects
- Steps: POST valid image → Expected: 500; the just-inserted `field_note_photos` row is deleted (no metadata row pointing at a missing blob)
- Defect(s): permanent broken image in admin + public gallery

### P9 - Upload to a draft does not fire the build hook
- Category: Side-effect scoping — P1 — Positive

### P10 - Upload to a published note fires the build hook
- Category: Side-effect scoping — P1 — Positive

### P11 - Caption (alt) capped at 300 chars
- Category: Validation — P2 — Edge

### P12 - Unauthenticated upload → 401, zero side effects
- Category: Security — P0 — Security

## Phase: Photo manage (PATCH / DELETE)

### M1 - Cover swap is a single atomic UPDATE
- Category: Concurrency — P0 — Concurrency
- Steps: PATCH `{id, is_cover:true}`
- Expected: exactly one UPDATE matching `SET is_cover = (id = $x) WHERE note_id = $y`; **no** separate unset-all statement
- Defect(s): interleaved requests leaving zero or two covers

### M2 - Explicit un-cover only clears the target photo
- Category: Contract — P2 — Positive
- Steps: PATCH `{id, is_cover:false}` → Expected: single-row `SET is_cover = FALSE WHERE id`

### M3 - Photo delete removes the DB row before the blob
- Category: Partial failure ordering — P0 — Positive
- Steps: DELETE `{id}`; record operation order
- Expected: `DELETE FROM field_note_photos` strictly precedes `store.delete`
- Defect(s): dangling metadata row on blob-delete failure (broken image)

### M4 - Blob-delete failure after row delete → 500, row stays gone
- Category: Partial failure — P1 — Edge
- Expected: 500 surfaced, but metadata row deleted (orphaned blob is the accepted worst case — invisible, not broken)

### M5 - PATCH unknown photo → 404
- Category: Contract — P2 — Negative

### M6 - Non-integer sort_order is ignored
- Category: Validation — P2 — Edge
- Steps: PATCH `{id, sort_order: "2; DROP TABLE"}` → Expected: no sort_order UPDATE executed; 200

### M7 - Caption edit on a published note's photo fires the hook
- Category: Side-effect scoping — P2 — Positive

## Phase: Build-time load (`src/_data/fieldNotes.js`)

### B1 - Only published notes are returned, photos and cover attached
- Category: Draft gate / data shaping — P0 — Positive
- Expected: drafts absent; each note has `photos[]` with public URLs, `cover` = the `is_cover` photo, `date_display` string

### B2 - Cover fallback: first photo, else null
- Category: Data shaping — P1 — Edge

### B3 - Missing NETLIFY_DATABASE_URL → empty array with a warning
- Category: Local-dev resilience — P1 — Edge
- Expected: `[]` returned, `console.warn` mentions the variable; **no throw** (plain `npm run dev` must keep working)

### B4 - DB error with env set → build fails loudly
- Category: Resilience — P0 — Negative
- Expected: the data function **rejects** (Eleventy build fails, previous good deploy stays live) — it must NOT swallow the error and return `[]`
- Defect(s): a transient DB blip silently wiping the public archive

### B5 - Zero published notes → empty array, no photo query
- Category: Efficiency/contract — P2 — Edge

### B6 - date_display: same-month range uses en dash ("July 16–18, 2026")
- Category: Presentation contract — P1 — Positive

### B7 - date_display variants: single day, cross-month, cross-year
- Category: Presentation contract — P2 — Edge
- Expected: "May 9, 2026" / "June 30 – July 2, 2026" / "December 30, 2026 – January 2, 2027"

### B8 - The published filter lives in the SQL, not post-filtering
- Category: Security contract — P0 — Security
- Expected: the executed query text contains `status = 'published'` — the draft-leakage gate asserted directly

### B9 - Netlify build without the DB env var falls back to the site feed
- Category: Resilience / platform gap — P0 — Positive
- Preconditions: `NETLIFY=true`, `URL` set, no `NETLIFY_DATABASE_URL` (Netlify's built-in Database injects the connection string into the functions runtime only, never into builds)
- Expected: fetches `${URL}/api/field-notes-feed`, shapes notes/photos/cover/date_display identically to the direct-DB path; no DB calls

### B10 - Feed 404 (bootstrap) warns and builds empty
- Category: Deploy ordering — P1 — Edge
- Preconditions: the live site predates the feed function (the build fetches the *previous* deploy's functions)
- Expected: `[]` with a warning — a throw here would deadlock the first deploy of the feed itself

### B11 - Any other feed failure fails the build
- Category: Resilience — P0 — Negative
- Expected: non-404 error → reject → deploy fails → previous good archive stays live

## Phase: Build feed function (`field-notes-feed.mjs`)

### F1 - Serves published entries only, gate in the SQL, no-store caching
- Category: Security contract — P0 — Security
- Expected: 200 `{notes, photos}`; query text contains `status = 'published'`; `Cache-Control: no-store` (the build fetches moments after a publish — a cached response would bake stale content into the new deploy)

### F2 - Zero published notes → empty arrays, no photo query
- Category: Efficiency — P2 — Edge

### F3 - Non-GET methods → 405
- Category: Contract — P2 — Negative

## Phase: Public photo serving (`field-photo.mjs`)

### S1 - Published photo → 200 with stored content type and immutable caching
- Category: Happy path — P0 — Positive
- Preconditions: metadata row exists, parent note `published`, blob present
- Expected: 200; `Content-Type` from blob metadata; `Cache-Control: public, max-age=31536000, immutable`

### S2 - Malformed UUID path params → 404 without touching the DB or store
- Category: Security — P0 — Security
- Defect(s): key/path traversal via crafted params

### S3 - Missing blob (row exists) → 404
- Category: Contract — P1 — Negative

### S4 - Missing blob metadata falls back to image/jpeg (row present and published)
- Category: Resilience — P2 — Edge
- Preconditions: metadata **row exists** and parent note is published; only the blob's stored `contentType` metadata is absent
- Expected: 200 with `Content-Type: image/jpeg`. This fallback applies solely to the blob-metadata field — a missing **database row** is always a 404 (S7) and must never fall through to this path

### S5 - Draft-note photo is not served to the public
- Category: Security (draft leakage) — P0 — Security
- Preconditions: row exists, parent note `draft`, no admin session
- Expected: 404; blob store never queried
- Defect(s): draft trip photos reachable at their public URL before publish

### S6 - Draft-note photo is served to an admin session with no-store caching
- Category: Contract — P0 — Positive
- Preconditions: valid admin session cookie
- Expected: 200; `Cache-Control: private, no-store` (the roster console previews draft thumbnails through this route; the CDN must never cache the authorized response for public reuse)

### S7 - Orphaned blob (no metadata row) is never served
- Category: Security / cleanup — P0 — Security
- Preconditions: blob exists, row deleted (M4's accepted failure mode, or a deleted note)
- Expected: 404; blob store never queried
- Defect(s): deleted notes' photos living on at their old URLs

## Phase: Markdown rendering gate (`.eleventy.js` `markdown` filter)

### R1 - Raw HTML/script in a note body is escaped, never executed
- Category: Security (stored XSS) — P0 — Security
- Steps: render `<script>alert(1)</script>` through the filter
- Expected: output contains `&lt;script&gt;`, no literal `<script>` tag (markdown-it `html:false`)

### R2 - Markdown features render (bold, lists, autolinked URLs)
- Category: Happy path — P1 — Positive

### R3 - Null/undefined body renders to empty string
- Category: Resilience — P2 — Edge

# Cross-cutting security, resilience, and concurrency tests

- N21 / P12: auth-first on every admin method, zero side effects when rejected.
- N13 / P6 / S2: UUID guards before persistence on every id-bearing input.
- S5 / S6 / S7: photo access control — published = public, draft = admin-only (`no-store`), orphan = 404. URL unguessability is defense-in-depth, not the gate.
- M1: single-statement cover swap (race-free by construction).
- N22: build hook is fire-and-forget — hook outage degrades to "publish delayed", never "publish failed".
- B4 vs B3: asymmetric failure policy (missing env = benign local dev → `[]`; DB error in CI/deploy = fail the build) asserted separately.
- Last-write-wins on concurrent note PATCHes is accepted behavior (no test asserts locking — documented above).

# Observability and logging assertions

- N22: hook failure logged via `console.error('Build hook failed:', …)`.
- P8: blob write failure logged before the 500.
- B3: local-dev fallback logged via `console.warn('[fieldNotes] …')`.

# Code review risk checklist

- **Draft leakage:** every public read path must enforce the publication-status gate. Today there are three: `fieldNotes.js` (the `status = 'published'` SQL filter, pinned by B8), `field-photo.mjs` (the row-join + status/session check, pinned by S5–S7), and `field-notes-feed.mjs` (the published-only SQL filter, pinned by F1). Any new public read path must add the equivalent check — and a test that pins it.
- **Slug stability:** never regenerate a slug when `published_at IS NOT NULL` — shared links die (N10).
- **Ordering bugs:** photo create is DB-first + rollback (P8); photo delete is DB-first, blob second (M3/M4). Reversing either reintroduces broken-image states. The DB row is the access-control source of truth for serving (S5–S7) — deleting it first also revokes public access immediately.
- **Serving cache modes:** published responses are `immutable`; any authorized draft response must stay `private, no-store` — a `public` cache header on the draft path would leak drafts through the CDN.
- **Hook scoping:** `triggerBuild()` only when the mutation is publicly visible (N15/N18/P9) — otherwise every draft keystroke burns a Netlify build.
- **Body limits:** keep the 5 MB cap under Netlify's ~6 MB function limit (P5); client downscaling is an optimization, not the guard.
- **`src/images/field/` must never exist** — the Eleventy passthrough copy would shadow the image-serving function route.
- **esc() in roster.js is attribute-safe** (escapes quotes); any new render helper must be too.
- **Common incomplete tests:** asserting only status codes without asserting *absence* of side effects (no INSERT/blob write on the rejection paths) — the suite asserts both.
