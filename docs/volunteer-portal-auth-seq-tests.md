# Volunteer Portal Authentication — Sequence-Derived Test Suite

Generated from the Volunteer → AuthClient → NetlifyIdentity → PortalAPI → Database sequence.

Runnable suite: `netlify/functions/__tests__/volunteer-portal-auth-flow.test.ts`. Every case below has one matching Vitest `it(...)` block with the same ID.

## System model inferred from the diagram

| Diagram participant | Implementation and responsibility                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Volunteer           | A public visitor who signs in or registers, then sees either the private portal or an account-status explanation.                                             |
| AuthClient          | `src/js/auth-client.js` handles sign-in/registration; `src/js/portal.js` loads the profile and renders access state.                                          |
| NetlifyIdentity     | Netlify Identity authenticates credentials, confirms email ownership, and supplies the verified user/session to server functions through `@netlify/identity`. |
| PortalAPI           | `netlify/functions/portal-profile.mjs` and `netlify/functions/lib/portal-auth.mjs` provision/load the profile and enforce status/role gates.                  |
| Database            | Netlify Database table `user_profiles`, keyed uniquely by `identity_user_id`, is the ministry-controlled source of approval status and portal role.           |

### State and trust model

- Identity answers **who the person is**. The database answers **what that person may access**.
- A normal first-time account is created as `role=member`, `status=pending`. Registration alone never grants private access.
- Profile states are `pending`, `active`, `denied`, and `suspended`. Only `active` users may use permission-gated member features.
- A coordinator is recognized only from trusted Identity role data and is reconciled to `role=coordinator`, `status=active`.
- If a database coordinator loses the trusted Identity coordinator role, the next login demotes the profile to `member` and suspends it. This fail-closed behavior prevents stale elevated access.
- The browser never chooses its own role or approval status. Headers, form fields, URL fragments, and profile metadata are untrusted input.
- Profile provisioning uses one `INSERT ... ON CONFLICT` statement, so first login is idempotent and does not expose a partially created profile.

### Async boundaries and side effects

- Browser → Netlify Identity: credential authentication or account registration.
- Netlify Identity → PortalAPI: verified session resolution through `getUser()`.
- PortalAPI → Database: one profile upsert/load per authenticated portal request.
- PortalAPI → Browser: a no-store public profile containing the access status used by the UI.
- Confirmed-signup and account-deletion Identity hooks create/suspend the corresponding database profile.
- This sequence has no photo bytes, file writes, blob storage, subprocesses, streams, or build hooks. Photo management remains outside this authentication suite, and its existing behavior is unchanged by this work.

## Assumptions and ambiguities

- **Assumed:** Netlify Identity validates passwords, email-confirmation tokens, token signatures, expiration, and revocation. The application contract begins with `getUser()` returning either a verified user or `null`.
- **Assumed:** Netlify Database tagged-template interpolation is parameterized. B9 verifies that hostile metadata remains in bound values and never enters SQL text.
- **Assumed:** the email-confirmation setting may vary by environment. A4 covers confirmation required; A5 covers auto-confirmation.
- **Assumed:** the `identity_user_id` uniqueness constraint is present. The migration-level constraint is covered separately by `test/portal-database.test.mjs`; B4 covers the concurrent application behavior.
- **Ambiguity:** the diagram says “show portal or account status.” The current site allows all authenticated users to open the portal shell to see their state, but private volunteer tools must remain unavailable until `active`.
- **Ambiguity:** Netlify converts an uncaught database error into a platform 5xx response. D5 asserts no partial database record; C8 asserts the browser fails closed with a generic retry message rather than promising a specific Netlify error shape.
- **Out of scope:** password reset, coordinator approval/deny/suspend UI actions, photo upload/management, and profile editing are separate sequences and should receive their own suites.

## Test cases by phase

## Phase A — AuthClient sign in or register

### A1 — Sign in with valid credentials

- Category: Happy path / browser contract
- Priority: P0
- Type: Positive
- Preconditions: public login page; no existing browser session; Identity accepts credentials.
- Steps: enter an email with surrounding spaces and a valid password; submit.
- Expected: `login()` receives the trimmed email and unchanged password; browser opens `/portal/`.
- Defects caught: malformed credential handoff, whitespace-induced login failure, successful login left on public page.
- Notes: password content is intentionally not trimmed.

### A2 — Invalid credentials fail safely

- Category: Authentication / error handling
- Priority: P0
- Type: Negative
- Preconditions: Identity rejects the login as invalid.
- Steps: submit an email and incorrect password.
- Expected: remain on `/login/`; show the safe incorrect-email-or-password message; re-enable submit for retry.
- Defects caught: provider error leakage, accidental portal navigation, permanently disabled form.
- Notes: the wording does not disclose whether the email exists.

### A3 — Registration password mismatch

- Category: Validation
- Priority: P1
- Type: Negative
- Preconditions: public registration form.
- Steps: enter different password and confirmation values; submit.
- Expected: Identity is not called; mismatch message is shown.
- Defects caught: unnecessary account request, confusing provider error, unintended partial registration.
- Notes: strength rules remain Netlify Identity's responsibility.

### A4 — Registration requiring email confirmation

- Category: Registration / data contract
- Priority: P0
- Type: Positive
- Preconditions: signup succeeds but Identity does not create a browser session yet.
- Steps: submit email, profile fields with surrounding whitespace, and matching passwords.
- Expected: `signup()` receives trimmed email/profile metadata; form is disabled after success; user is instructed to open the confirmation email; no portal navigation occurs.
- Defects caught: lost request details, unconfirmed access, duplicate repeat submissions.
- Notes: coordinator review begins after the account/email is confirmed.

### A5 — Auto-confirmed registration

- Category: Registration / alternate platform configuration
- Priority: P1
- Type: Positive
- Preconditions: signup succeeds and `getUser()` immediately returns the new user.
- Steps: submit a valid registration.
- Expected: one signup call; browser opens `/portal/` for profile provisioning/status display.
- Defects caught: auto-confirmed user stranded on registration page, duplicate signup.
- Notes: portal access is still database-gated; auto-confirmation is not auto-approval.

### A6 — Duplicate registration

- Category: Registration / error handling
- Priority: P1
- Type: Negative
- Preconditions: Identity reports the email is already registered.
- Steps: submit a registration using that email.
- Expected: remain public; explain that an account exists and offer sign-in/reset direction; do not expose raw provider details.
- Defects caught: ambiguous failure, accidental account enumeration detail, portal navigation after failed signup.
- Notes: wording is intentionally user-friendly for a nontechnical audience.

### A7 — Identity service unavailable

- Category: Resilience
- Priority: P0
- Type: Edge / failure
- Preconditions: Identity request fails to reach the provider.
- Steps: submit login.
- Expected: show service-unavailable guidance; re-enable submit; remain public.
- Defects caught: frozen form, false authentication, raw network exception.
- Notes: preview environments without Identity use the same safe outcome.

## Phase B — Authenticated session and profile provisioning

### B1 — Missing, expired, or revoked session

- Category: Authentication gate
- Priority: P0
- Type: Negative / security
- Preconditions: `getUser()` returns `null` (the application-visible result for no valid session).
- Steps: GET `/api/portal/profile`.
- Expected: 401 with `Cache-Control: no-store`; database is never opened or queried.
- Defects caught: anonymous profile creation, stale-session access, cached authentication errors.
- Notes: token cryptography/expiry is owned by Netlify Identity and represented by the null result.

### B2 — First member login provisions pending profile

- Category: Happy path / state transition
- Priority: P0
- Type: Positive
- Preconditions: verified non-coordinator Identity user; no profile row.
- Steps: GET `/api/portal/profile`.
- Expected: one profile is created; response is 200/no-store with `role=member`, `status=pending`, and Identity metadata.
- Defects caught: accidental auto-approval, duplicate records, cache leakage, missing profile.
- Notes: pending lets the volunteer see status but not private tools.

### B3 — Repeat login preserves approval

- Category: Idempotency / data integrity
- Priority: P0
- Type: Positive / edge
- Preconditions: existing `active/member` profile for the Identity subject.
- Steps: provision/load twice.
- Expected: both calls return the same profile ID; status remains active; only one row exists.
- Defects caught: approval reset on login, duplicate profile, unstable identifiers.
- Notes: email and last-login timestamp may legitimately refresh.

### B4 — Concurrent first logins remain idempotent

- Category: Concurrency
- Priority: P0
- Type: Race / edge
- Preconditions: no profile; two valid requests for the same Identity subject overlap.
- Steps: start two profile upserts before either result is consumed.
- Expected: both return the same profile ID; exactly one logical profile exists; each request uses the `ON CONFLICT` upsert.
- Defects caught: duplicate account requests, unique-violation 500s, split state.
- Notes: the database uniqueness constraint is the production serialization point.

### B5 — Client role spoofing is ignored

- Category: Authorization / trust boundary
- Priority: P0
- Type: Security
- Preconditions: verified Identity user has no coordinator role.
- Steps: send GET with client headers claiming `coordinator/active`.
- Expected: returned profile remains `member/pending`.
- Defects caught: privilege escalation through headers or browser-controlled state.
- Notes: the current endpoint does not consume these headers; the test makes that boundary explicit.

### B6 — Trusted coordinator provisioning

- Category: Authorization / state transition
- Priority: P0
- Type: Positive
- Preconditions: verified Identity user carries the trusted `coordinator` role.
- Steps: GET profile with no existing row.
- Expected: profile is created/reconciled as `coordinator/active`.
- Defects caught: coordinator locked out, coordinator incorrectly left pending.
- Notes: coordinator assignment is managed in Netlify Identity, not by public registration metadata.

### B7 — Removed coordinator role fails closed

- Category: Authorization / revocation
- Priority: P0
- Type: Security / edge
- Preconditions: database says `coordinator/active`; current verified Identity user no longer has coordinator role.
- Steps: load profile on next portal request.
- Expected: profile becomes `member/suspended`.
- Defects caught: stale elevated access after role removal, silent demotion that leaves member access active.
- Notes: a coordinator must deliberately reactivate the account if appropriate.

### B8 — Identity user without email

- Category: Contract validation
- Priority: P0
- Type: Negative
- Preconditions: verified-user object has an ID but no usable email.
- Steps: provision/load profile.
- Expected: controlled error before any SQL is issued.
- Defects caught: invalid required-column write, phantom account, misleading blank profile.
- Notes: this indicates a provider/configuration contract failure.

### B9 — Hostile metadata is parameterized

- Category: Input security / database boundary
- Priority: P0
- Type: Security
- Preconditions: verified user has SQL-like text in `full_name`.
- Steps: provision first profile.
- Expected: text is a bound SQL value, absent from SQL source; profile stays `member/pending`.
- Defects caught: SQL injection, metadata-based self-approval.
- Notes: the value may be displayed later only through existing HTML escaping/output rules.

### B10 — Suspended profile blocked by active-only gate

- Category: Authorization
- Priority: P0
- Type: Security / negative
- Preconditions: verified user profile is suspended.
- Steps: call a session guard with `activeOnly=true`.
- Expected: 403/no access response.
- Defects caught: suspension that is merely cosmetic, private feature access after suspension.
- Notes: base profile GET remains available so the user can see why access is unavailable.

### B11 — Member blocked by coordinator-role gate

- Category: Authorization
- Priority: P0
- Type: Security / negative
- Preconditions: verified profile is `active/member`.
- Steps: call a guard requiring active coordinator.
- Expected: 403 permission response.
- Defects caught: active members reaching account administration.
- Notes: `active` and `coordinator` are separate requirements.

### B12 — Active coordinator passes both gates

- Category: Authorization
- Priority: P0
- Type: Positive
- Preconditions: verified Identity and profile both reconcile to `active/coordinator`.
- Steps: require active status and coordinator role.
- Expected: no error response; session carries the coordinator profile.
- Defects caught: over-restrictive guard, wrong order of reconciliation and authorization.
- Notes: downstream coordinator endpoints must still use this guard.

## Phase C — Portal display and access status

### C1 — Pending status view

- Category: UI state / least privilege
- Priority: P0
- Type: Positive
- Preconditions: API returns `pending/member` profile.
- Steps: boot the real portal client.
- Expected: waiting-for-review explanation; private tools described as unavailable until approval; coordinator controls hidden.
- Defects caught: pending user confusion, premature private navigation.
- Notes: profile contact information may still be editable under the separate profile-update contract.

### C2 — Active member view

- Category: UI state
- Priority: P0
- Type: Positive
- Preconditions: API returns `active/member`.
- Steps: boot portal.
- Expected: Approved label and active volunteer-tools message.
- Defects caught: approved user shown as pending, useful portal content withheld.
- Notes: this suite does not define the future photo-upload navigation.

### C3 — Denied status view

- Category: UI state / access denial
- Priority: P1
- Type: Positive / edge
- Preconditions: API returns `denied/member`.
- Steps: boot portal.
- Expected: Not approved label; coordinator controls hidden.
- Defects caught: denied user treated as active, missing account outcome.
- Notes: any decision message is supplied by the coordinator review flow.

### C4 — Suspended status view

- Category: UI state / suspension
- Priority: P0
- Type: Security / positive
- Preconditions: API returns `suspended/member` with a decision message.
- Steps: boot portal.
- Expected: Access suspended label; no private-tool promise; coordinator contact/decision message visible.
- Defects caught: suspended access appearing active, essential suspension not communicated.
- Notes: the server-side B10 gate is authoritative; UI hiding is defense in depth.

### C5 — Coordinator navigation visibility

- Category: UI authorization
- Priority: P0
- Type: Positive
- Preconditions: API returns `active/coordinator`.
- Steps: boot portal.
- Expected: coordinator navigation/dashboard card shown; account list request issued.
- Defects caught: coordinator unable to review accounts, member-only presentation.
- Notes: server guards remain required even when navigation is visible.

### C6 — Member forces `#access`

- Category: UI authorization / route manipulation
- Priority: P1
- Type: Security / negative
- Preconditions: URL contains `#access`; API returns `active/member`.
- Steps: boot portal.
- Expected: dashboard opens, access view stays hidden, unauthorized fragment is removed.
- Defects caught: direct-fragment disclosure of coordinator UI.
- Notes: this complements, but never replaces, B11.

### C7 — Portal profile request returns 401

- Category: Session handling
- Priority: P0
- Type: Negative
- Preconditions: visitor opens `/portal/`; API returns 401.
- Steps: boot portal.
- Expected: redirect to `/login/`; portal shell remains hidden.
- Defects caught: stale portal content after logout, anonymous shell disclosure.
- Notes: login can then explain or restart authentication.

### C8 — PortalAPI/database failure

- Category: Resilience / fail closed
- Priority: P0
- Type: Failure
- Preconditions: API returns 5xx.
- Steps: boot portal.
- Expected: generic refresh/try-later message; portal shell remains hidden.
- Defects caught: false active access, raw internal error leakage, blank screen.
- Notes: detailed failure belongs in server/platform logs, not the browser.

### C9 — Malformed success payload

- Category: Contract resilience
- Priority: P1
- Type: Negative / edge
- Preconditions: API returns 200 with `profile:null`.
- Steps: boot portal.
- Expected: fail closed with generic portal-load message; shell hidden.
- Defects caught: runtime crash exposing half-rendered controls, treating missing status as approved.
- Notes: future schema validation could make this branch more explicit.

## Phase D — Account lifecycle and cross-cutting safeguards

### D1 — Confirmed-signup hook pre-creates profile

- Category: Lifecycle / eventual consistency
- Priority: P0
- Type: Positive
- Preconditions: Netlify sends confirmed signup event; database available.
- Steps: execute `userSignup`.
- Expected: pending/member row created; Identity app metadata receives `pending` when no existing roles are present.
- Defects caught: coordinator cannot see request until first portal visit, missing initial status label.
- Notes: first-login upsert remains the recovery path.

### D2 — Signup hook database outage

- Category: Partial failure / resilience
- Priority: P0
- Type: Failure
- Preconditions: database insert throws during confirmed signup.
- Steps: execute `userSignup`.
- Expected: error logged; hook still returns pending Identity metadata; no partial row.
- Defects caught: temporary database outage blocking account confirmation, half-created profile.
- Notes: the later first-login request retries provisioning.

### D3 — Identity account deletion suspends profile

- Category: Lifecycle / revocation
- Priority: P0
- Type: Security
- Preconditions: active profile exists; Netlify sends deletion event.
- Steps: execute `userDeleted`.
- Expected: `identity_deleted_at` recorded and status set to suspended.
- Defects caught: deleted Identity account appearing active in ministry records.
- Notes: retaining the row supports audit/history; hard deletion is not required.

### D4 — Cross-user profile isolation

- Category: Multi-user isolation
- Priority: P0
- Type: Security / concurrency-adjacent
- Preconditions: two Identity subjects have profiles with different statuses.
- Steps: request profile as user A, then as user B.
- Expected: each response returns only the profile keyed by the verified subject; states do not bleed across sessions.
- Defects caught: insecure direct-object reference, shared/global profile cache.
- Notes: the endpoint accepts no profile ID from the browser.

### D5 — First-login upsert failure leaves no partial profile

- Category: Atomicity / partial failure
- Priority: P0
- Type: Failure
- Preconditions: no profile; database fails during upsert.
- Steps: provision first login.
- Expected: operation rejects; no profile is left in the model.
- Defects caught: incomplete rows, browser receiving false pending/active state.
- Notes: Portal UI behavior for the resulting 5xx is C8.

### D6 — No unrelated I/O or legacy photo side effects

- Category: Side-effect scoping
- Priority: P1
- Type: Security / regression
- Preconditions: portal auth/profile source.
- Steps: inspect the bundled source contracts used by the test without runtime disk I/O.
- Expected: no filesystem, subprocess, stream, Netlify Blobs, field-photo, or build-hook dependencies.
- Defects caught: authentication unexpectedly mutating unrelated photo infrastructure or invoking unsafe host I/O.
- Notes: future photo upload must be introduced through a separately permission-gated, separately tested sequence.

## Cross-cutting coverage summary

- **Security:** B1, B5, B7–B11, C4, C6–C9, D3–D4, D6.
- **Resilience / partial failure:** A7, C8–C9, D2, D5.
- **Concurrency / idempotency:** B3–B4; database constraint coverage remains in `test/portal-database.test.mjs`.
- **Input boundaries:** A1, A3–A4, B8–B9.
- **Account states:** B2, B6–B7, B10–B12, C1–C5.
- **File/subprocess/stream/blob behavior:** deliberately absent and regression-checked by D6 because those systems are not participants in this sequence.

## Observability expectations

- Identity authentication failures should remain user-safe; provider details should be available through Netlify function/Identity logs, not rendered to the visitor.
- Confirmed-signup database failures must log `Could not pre-create portal profile at signup` with the underlying error (D2).
- Netlify should record function status/latency for `/api/portal/profile`; alerting should distinguish elevated 401s from 5xx database/platform failures.
- Database monitoring should track upsert failures and unique-constraint errors. A unique error on this path would indicate the `ON CONFLICT` contract has regressed.
- Coordinator decisions and suspensions are recorded by the separate account-review API/audit-log sequence; this authentication suite verifies only that resulting status is enforced.
- Sensitive credential values, session tokens, and passwords must never be logged. Profile responses use `Cache-Control: no-store`.

## Code-review checklist

- [ ] Every protected function obtains a verified Identity user server-side; no browser-provided user ID, role, or status is trusted.
- [ ] New member profiles default to `pending/member`, never `active`.
- [ ] `activeOnly` is applied to every future private volunteer capability, including any future photo uploader.
- [ ] Coordinator endpoints require both `status=active` and `role=coordinator`.
- [ ] Coordinator role removal continues to suspend/demote rather than preserving stale privilege.
- [ ] Profile upsert remains a single parameterized `INSERT ... ON CONFLICT` statement keyed by `identity_user_id`.
- [ ] Unauthenticated responses stop before database access and all profile/session responses remain `no-store`.
- [ ] Portal UI fails closed for 401, 5xx, and malformed payloads.
- [ ] User-facing errors do not reveal provider internals or whether an account email exists beyond the intended duplicate-registration guidance.
- [ ] Authentication code has no dependency on the photo-management system.
- [ ] Runnable tests keep one `it(...)` per A1–A7, B1–B12, C1–C9, and D1–D6 case and complete without network/disk side effects.
