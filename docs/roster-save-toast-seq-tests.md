# Field note save-toast flow — sequence-diagram test spec

Source diagram: `noteForm → saveNote → (alt: first draft save keeps editor open / later save closes modal) → showToast`.
Code under test: `src/js/roster.js` (note editor modal, `saveNote`, submit handler, `showToast`), markup in `src/roster.njk`, styling in `src/css/roster.css`.
Runnable suite: `src/js/__tests__/roster-save-toast.test.ts` (Vitest + happy-dom, boots the real IIFE against the real `roster.njk` body markup with `fetch` mocked).

# System model inferred from diagram

- **Participants**
  - `noteForm` — the `<form id="noteForm">` inside the editor modal; its submit handler orchestrates the whole flow.
  - `saveNote` — validates the payload (title + start date required), POSTs new notes / PATCHes existing ones to `/api/admin/field-notes`, then re-fetches the list (`loadFieldNotes`) and re-resolves `currentNote` from the fresh list.
  - `noteModal` — `#noteOverlay` + `closeNote()` (hides overlay, clears `currentNote`, restores focus to the triggering element).
  - `showToast` — `#toast` element; sets `textContent`, unhides, auto-hides after 4 s; consecutive calls reset the timer.
- **Inputs**: `note-title`, `note-start`, `note-end`, `note-body` field values; implicit state `currentNote` (null = new note) captured as `isNew` *before* the save.
- **Outputs / side effects**: HTTP POST/PATCH + refresh GET; mutated `notes` array and re-rendered list; modal visibility; toast message; focus location; button disabled state.
- **State transitions**: new (no `currentNote`) → draft (first save, modal stays open, photo section unlocks) → saved-again (modal closes) ; published notes take the same close path with a different toast message.
- **Trust boundaries**: all server responses are untrusted JSON; note fields are author-controlled strings that get interpolated into list markup (`esc()`) and must never reach `innerHTML` unescaped. A 401 on any call flips the whole console to the login view.
- **Async boundaries**: fetch for save; second fetch for list refresh; 4 s toast timer.
- **User-visible outcomes**: first draft save → toast "Draft saved — you can add photos now." with editor still open; later draft save → modal closes + "Draft saved."; published save → modal closes + "Saved — changes go live after the site rebuilds (~1–2 min)."; failure → modal stays open with inline `#noteError`, no toast.

# Assumptions and ambiguities

1. **"first draft save" = `currentNote === null` at submit time** (`isNew`), not "note has status draft". A draft that already exists closes on save.
2. The diagram's `showToast --> noteForm: keep editor open` is really the *absence* of `closeNote()`; the toast does not control the modal.
3. **Publish/Unpublish is out of the diagram** but shares `saveNote`; assumed contract: publish keeps the modal open (it re-renders controls) and shows no close-toast. Tests pin this so the close-on-save behavior doesn't leak into the publish handler.
4. **Refresh failure after a successful write is ambiguous**: `saveNote` awaits `loadFieldNotes()` after the PATCH, so a failed refresh surfaces as "Save failed" even though the row was written. Pinned as current behavior; flagged as a defect candidate (misleading error, and a resubmit would double-write for POST).
5. **401 mid-save**: `api()` calls `showLogin()` and throws. The note overlay lives outside `#consoleView`, so the modal remains visible on top of the login view with "Save failed: Not authenticated". Pinned as current behavior; probably should close the modal.
6. Implicit form submission (Enter in a text field) while the save button is disabled is blocked by the HTML default-button rule; a programmatic `dispatchEvent(submit)` is not. No in-flight guard exists beyond the disabled button.
7. No dirty-state check: Cancel/Escape/backdrop discard unsaved edits silently (missing safeguard, out of scope to fix here).
8. Toast is a singleton; overlapping messages overwrite (last-writer-wins) and reset the 4 s timer. Assumed intended.

# Test cases by phase

## Phase A: submission and validation (noteForm → saveNote)

### SAVE-A1 - New note happy path sends a trimmed POST payload
- Category: contract integrity
- Priority: P0
- Type: Positive
- Preconditions: console booted (authenticated), New Entry modal open, no `currentNote`.
- Steps: fill title with surrounding whitespace, start date, body; leave end date empty; submit.
- Expected results: exactly one `POST /api/admin/field-notes` with `{title: <trimmed>, start_date, end_date: null, body}`; a refresh `GET` follows.
- Defect(s) this could expose: untrimmed titles; `""` instead of `null` end date; missing refresh.
- Notes: also asserts no PATCH is sent for a new note.

### SAVE-A2 - Missing title blocks the save client-side
- Category: input validation
- Priority: P0
- Type: Negative
- Steps: leave title empty, fill start date, submit.
- Expected results: no field-note POST/PATCH; `#noteError` visible with "A title and trip start date are required."; modal open; toast hidden.
- Defect(s): network call on invalid input; silent no-op.

### SAVE-A3 - Missing start date blocks the save client-side
- As SAVE-A2 with title filled and start date empty. Same expectations.

### SAVE-A4 - Whitespace-only title is rejected
- Category: input validation / boundary
- Priority: P1
- Type: Edge
- Steps: title = `"   "`, valid start date, submit.
- Expected results: treated as missing (trim happens before validation); no network call.
- Defect(s): validating before trimming.

### SAVE-A5 - Save button disabled while the request is in flight
- Category: state integrity / double-submit
- Priority: P1
- Type: Concurrency
- Steps: make the PATCH hang on a deferred promise; submit; inspect `#noteSaveBtn.disabled`; resolve; flush.
- Expected results: disabled during flight, re-enabled after; exactly one write request.
- Defect(s): missing `finally` re-enable (button stuck); double-submit window.

### SAVE-A6 - Server error keeps the modal open with an inline error and no toast
- Category: error handling
- Priority: P0
- Type: Negative
- Steps: PATCH responds 500 `{error: "db exploded"}`; submit on an existing note.
- Expected results: modal still visible; `#noteError` shows "Save failed: db exploded"; toast hidden; button re-enabled; no `closeNote()` (trigger focus untouched).
- Defect(s): closing the modal on failure (losing the author's edits); toast firing on failure.

### SAVE-A7 - 401 mid-save drops to the login view (pins current modal-stays-open quirk)
- Category: auth boundary
- Priority: P1
- Type: Edge / Security-adjacent
- Steps: PATCH responds 401; submit on an existing note.
- Expected results (current behavior): login view visible, console view hidden, no toast; `#noteError` shows "Save failed: Not authenticated"; **note overlay is still un-hidden** (it lives outside `#consoleView`).
- Defect(s): documents the overlay-over-login quirk so a future fix consciously changes this assertion.

## Phase B: first draft save (alt branch — keep editor open)

### SAVE-B1 - First save keeps the editor open and toasts the photo hint
- Category: user-visible correctness
- Priority: P0
- Type: Positive
- Steps: open New Entry, fill valid fields, submit, flush.
- Expected results: `#noteOverlay` still visible; toast visible with exactly "Draft saved — you can add photos now."
- Defect(s): close-on-save applied to the `isNew` branch (locks authors out of adding photos).

### SAVE-B2 - First save unlocks photos, publish, and delete controls
- Category: state transition
- Priority: P0
- Type: Positive
- Steps: as SAVE-B1; inspect controls.
- Expected results: `#notePhotos` un-hidden, `#notePhotoLocked` hidden, `#notePublishBtn` ("Publish") and `#noteDeleteBtn` visible, save button reads "Save Draft".
- Defect(s): `updateNoteControls()` not called on the isNew branch.

### SAVE-B3 - Second submit after the first save PATCHes the server-issued id
- Category: contract integrity / idempotency
- Priority: P0
- Type: Positive
- Steps: after SAVE-B1, edit the title and submit again.
- Expected results: second write is a `PATCH` carrying the id returned by the POST; no duplicate POST; modal now **closes** (no longer new) with a "Draft saved." toast.
- Defect(s): `currentNote` not re-resolved after POST → duplicate note rows on every save.

## Phase C: later save (else branch — close modal + toast)

### SAVE-C1 - Saving an existing draft closes the modal and toasts "Draft saved."
- Category: user-visible correctness
- Priority: P0
- Type: Positive
- Preconditions: one existing draft note in the list.
- Steps: open it from the list, edit body, submit, flush.
- Expected results: one PATCH with the note id; `#noteOverlay` hidden; toast exactly "Draft saved."; `currentNote` cleared (Escape afterwards does nothing).
- Defect(s): modal left open (the original bug this feature fixes); wrong message branch.

### SAVE-C2 - Saving a published note toasts the rebuild reminder
- Category: user-visible correctness
- Priority: P0
- Type: Positive
- Preconditions: existing note with `status: "published"`.
- Steps: open, edit, submit, flush.
- Expected results: modal closed; toast exactly "Saved — changes go live after the site rebuilds (~1–2 min)."; PATCH body does **not** carry a `status` field (a plain save must never flip publish state).
- Defect(s): published/draft branch inverted; save accidentally republishing/unpublishing.

### SAVE-C3 - Focus returns to the triggering list card after close
- Category: accessibility
- Priority: P1
- Type: Positive
- Steps: open a note by clicking its list card, save, flush.
- Expected results: `document.activeElement` is the (re-rendered equivalent of the) card that opened the modal, or at minimum focus is no longer trapped in the hidden modal.
- Defect(s): keyboard users dumped to `<body>` after save.
- Notes: the list re-renders on refresh, so `noteTrigger` may be detached; `closeNote()` guards with `document.contains`. Assert focus is not inside the hidden overlay.

### SAVE-C4 - Refresh failure after a successful PATCH surfaces as a save error (pins misleading behavior)
- Category: partial failure
- Priority: P1
- Type: Edge
- Steps: PATCH succeeds; the follow-up `GET /api/admin/field-notes` responds 500; submit; flush.
- Expected results (current behavior): modal stays open; `#noteError` shows "Save failed: …"; no toast — even though the write landed.
- Defect(s): documents the misleading error; a retry from this state re-PATCHes (harmless) but on the POST path would create a duplicate note.

### SAVE-C5 - Note deleted concurrently between PATCH and refresh does not crash
- Category: concurrency / corrupted state
- Priority: P1
- Type: Concurrency
- Steps: PATCH succeeds but the refreshed list no longer contains the id (deleted in another tab); submit; flush.
- Expected results: no exception; `currentNote` resolves to `undefined` → falls into the non-published close path: modal closes, toast "Draft saved."
- Defect(s): unguarded `currentNote.status` deref (`TypeError`) leaving the button disabled and the modal stuck.

## Phase D: toast component (showToast)

### SAVE-D1 - Toast auto-dismisses after 4 seconds
- Category: user-visible correctness
- Priority: P1
- Type: Positive
- Steps: fake timers; trigger a close-path save; advance 3999 ms (still visible), then past 4000 ms.
- Expected results: hidden class re-applied only after the full 4 s.
- Defect(s): toast never dismissing, or dismissing instantly.

### SAVE-D2 - A second toast resets the dismiss timer (no stale-timer race)
- Category: timing
- Priority: P1
- Type: Concurrency
- Steps: fake timers; save note 1 (toast shows); advance 3 s; save note 2; advance 3 s; then 1 s more.
- Expected results: at +3 s after the second toast it is still visible showing the second message (the first timer was cleared); it hides 4 s after the *second* call.
- Defect(s): missing `clearTimeout` → second toast vanishes after 1 s.

### SAVE-D3 - Toast is announced politely to assistive tech
- Category: accessibility / observability
- Priority: P2
- Type: Observability
- Steps: inspect the `#toast` element from the real markup.
- Expected results: `role="status"` and `aria-live="polite"` present; element exists exactly once.
- Defect(s): markup regressions silently dropping SR announcements.

## Phase E: adjacent flows that share saveNote (guard rails)

### SAVE-E1 - Publish keeps the modal open and does not fire the close-toast
- Category: state transition / regression guard
- Priority: P0
- Type: Positive
- Steps: open an existing draft; click `#notePublishBtn`; flush.
- Expected results: PATCH carries `status: "published"`; modal still open; button now "Unpublish"; save button now "Save Changes"; status line visible; toast **hidden** (publish predates the toast feature and shows its state change in-modal).
- Defect(s): close-on-save leaking into the publish handler via shared `saveNote`.

### SAVE-E2 - Declining the unpublish confirm sends nothing
- Category: destructive-action guard
- Priority: P1
- Type: Negative
- Steps: open a published note; stub `confirm` → false; click Unpublish.
- Expected results: no PATCH; status unchanged; modal open.
- Defect(s): confirm result ignored.

### SAVE-E3 - Cancel and Escape close without saving and without a toast
- Category: invalid order of operations
- Priority: P1
- Type: Negative
- Steps: open a note, edit the title, press Escape (and separately click Cancel).
- Expected results: modal hidden; no PATCH/POST; toast hidden; edits discarded (documents the missing dirty-check from Assumption 7).
- Defect(s): closing paths accidentally triggering a save or a success toast.

# Cross-cutting security, resilience, and concurrency tests

### SAVE-X1 - Author-controlled note title cannot inject markup into the list
- Category: XSS
- Priority: P0
- Type: Security
- Steps: seed a note titled `<img src=x onerror="window.__pwned=1">'"` ; boot; inspect the rendered list.
- Expected results: no `img` element inside `#noteList`; title visible as literal text; `window.__pwned` undefined.
- Defect(s): `esc()` regression or a template switching to unescaped interpolation.
- Notes: toast messages are static strings (no interpolation), so the toast itself has no injection surface — the list render is the nearest sink for the same data.

(Also covered above: double-submit window SAVE-A5, concurrent delete SAVE-C5, timer race SAVE-D2, auth boundary SAVE-A7.)

# Observability and logging assertions

- `#noteError` is the single failure channel for the modal: every negative test asserts it is shown (with the operation-specific prefix) *and* that the toast stays hidden — one visible truth per outcome.
- `role="status"`/`aria-live="polite"` on `#toast` (SAVE-D3) is the screen-reader observability contract.
- Panel-load failures log via `console.error('Panel failed to load:', …)`; the suite's fetch router fails loudly (404 + recorded call log) on any unroutered request, so an unexpected new endpoint call fails a test instead of passing silently.
- Suggested (not implemented): a `data-testid`/custom event when the toast fires would let E2E tools assert feedback without sleeping; today the 4 s timer is only testable with fake timers.

# Code review risk checklist

- **`isNew` must be captured before `await saveNote()`** — after it, `currentNote` is set and every save would look like a "later save" (or worse, read after `closeNote()` nulls it). Check the ordering.
- **Message selection reads `currentNote.status` *before* `closeNote()`** clears it; reordering those two lines silently breaks the published-message branch (guarded by SAVE-C2).
- **Shared `saveNote` serves three callers** (save, publish, unpublish): any new side effect inside `saveNote` (like closing the modal) would fire for publish too — keep UX side effects in the submit handler (SAVE-E1 guards this).
- **`finally { btn.disabled = false }`** must survive refactors, including the throw-after-write path (SAVE-A5/C4).
- **Refresh-after-write failure** reports "Save failed" for a successful write; if this is ever fixed, split the try so write errors and refresh errors message differently — and update SAVE-C4.
- **401 path leaves the modal floating over the login view** (SAVE-A7); a fix should call `closeNote()` from `showLogin()` or hide overlays there.
- **Toast singleton**: `clearTimeout` before re-arming (SAVE-D2); use `textContent`, never `innerHTML`, if messages ever become dynamic.
- **No dirty-check on Cancel/Escape/backdrop** — silent data loss is one mis-click away; consider a confirm when fields differ from `currentNote`.
- **Duplicate-note risk**: on the POST path, any thrown error after the write but before `currentNote` is set means the next submit POSTs again. Server-side idempotency (e.g., slug/title+date uniqueness) is the real fix.
