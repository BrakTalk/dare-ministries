# System model inferred from diagram

The sequence protects legacy private-tool API handlers with two independent authorization layers.

- **Actors and participants:** `AdminRequest` is an untrusted HTTP client; `AdminHandler` is one of the protected Netlify Functions; `requireAuth` validates the signed shared-admin cookie and coordinates the second authorization factor; `PortalAuth` resolves the current Netlify Identity user and authoritative `user_profiles` row.
- **Protected endpoints:** `/api/admin/volunteers`, `/api/admin/contacts`, `/api/admin/impact-stats`, `/api/admin/field-notes`, and `/api/admin/field-note-photos`. `/api/admin/login` creates or checks the shared session, and `/api/admin/logout` clears it.
- **Inputs:** HTTP method, path, body, `dare_admin_session` cookie, the implicit Netlify Identity session, `ADMIN_PASSWORD`, and `SESSION_SECRET`.
- **Outputs:** the protected handler response, a stable JSON `401` for a missing or invalid shared session, the `PortalAuth` `401`/`403` response for a missing or unauthorized Identity/profile session, or a session cookie after successful login.
- **State transitions:** successful shared-password login creates a seven-day signed cookie; expiration or logout invalidates it; every protected request rechecks whether the Identity-backed database profile is still `active/coordinator`.
- **Data mutation:** authorization itself does not mutate application records. `getPortalSession` may update `last_login_at` and reconcile trusted coordinator state. A successful login or logout changes only the browser cookie. Downstream protected handlers can mutate domain data after authorization, but those operations are covered by their own suites.
- **Async boundaries:** every handler awaits `requireAuth`; `requireAuth` awaits `PortalAuth`; `PortalAuth` may call Identity and the database. Dependency rejection must fail closed.
- **Trust boundaries:** public request to Netlify Function; unsigned browser input to HMAC cookie verification; shared secret to signed session; Netlify Identity claims to database profile reconciliation; authorization result to downstream business logic.
- **External side effects:** Identity/database reads and profile reconciliation may occur inside `PortalAuth`. No filesystem, subprocess, file upload, download, stream, or SSE work belongs to this authorization sequence.
- **User-visible outcomes:** authorized users receive the requested private-tool response; unauthorized users receive `401` or `403`; the roster console reports its shared session as unauthenticated after coordinator access is revoked.

Existing `volunteer-portal-auth-flow.test.ts` cases already cover the internal pending, active, suspended, removed-role, member, and coordinator decisions inside `getPortalSession`. Existing field-note tests cover field-note CRUD and photo file size/type/blob behavior. This suite tests the new boundary between those components and intentionally does not duplicate their domain cases.

# Assumptions and ambiguities

- A valid private-tool request requires both a valid `dare_admin_session` cookie and an Identity-backed `user_profiles` record with `status=active` and `role=coordinator`.
- Missing/invalid shared authentication returns `401`. Missing Identity authentication also returns the `PortalAuth` `401`. Authenticated but inactive or non-coordinator profiles return `403`.
- `PortalAuth` is authoritative and returns either `{ user, profile, db }` or `{ response }`. A malformed result must fail closed.
- A `PortalAuth` exception is allowed to propagate to the Netlify runtime as a server failure; it must never be converted into authorization. Whether production should instead return a stable `503` is unresolved.
- `GET /api/admin/login` intentionally collapses expired, revoked, and unavailable authorization into `{ authenticated: false }` for the console boot flow.
- Logout must remain available even if Identity or the database is unavailable so a stale shared cookie can always be cleared.
- Authorization is checked on every request. There is no in-memory authorization cache, and duplicate requests are not assumed idempotent once downstream mutations begin.
- The shared password remains a second factor rather than the primary account authorization mechanism. Long-term removal of this legacy factor is outside this phase.
- File type/size/content, filesystem errors, subprocess lifecycle, and streaming interruption are not applicable to this authorization-only sequence. They remain in the existing field-note/photo suites where those resources exist.
- Suggested clarification: should dependency outages return a structured `503` with a correlation ID instead of the platform-generated `500`?
- Suggested clarification: should failed shared-password and revoked-profile attempts create a security audit event or metric?
- Suggested clarification: should login/logout require an explicit same-origin check in addition to `SameSite=Strict` cookies?

# Test cases by phase

## Phase: Shared admin-session validation

### PTA-001 - Missing shared admin session is rejected first

- Category: Authentication ordering
- Priority: P0
- Type: Negative
- Preconditions: No `dare_admin_session` cookie; `PortalAuth` is mocked.
- Steps: Send a protected request; await `requireAuth`.
- Expected results: JSON `401 {"error":"Not authenticated"}` with `Cache-Control: no-store`; `PortalAuth` is not called.
- Defect(s) this could expose: Identity/database work before primary session validation; accidental access without the legacy factor; cacheable auth failures.
- Notes: Implements the first trust-boundary short circuit.

### PTA-002 - Tampered shared cookie is rejected

- Category: Cookie integrity
- Priority: P0
- Type: Security
- Preconditions: Start with a signed cookie and alter its signature.
- Steps: Send a protected request with the altered cookie.
- Expected results: `401`; `PortalAuth` and downstream resources are not called; no exception leaks.
- Defect(s) this could expose: HMAC bypass, unsafe signature parsing, timing-safe comparison misuse.
- Notes: A different-length signature also exercises the constant-time comparison guard.

### PTA-003 - Expired shared cookie is rejected

- Category: Session expiration
- Priority: P0
- Type: Edge
- Preconditions: Create a valid cookie, then advance time beyond its seven-day expiration.
- Steps: Send a protected request with the expired cookie.
- Expected results: `401`; no `PortalAuth` call.
- Defect(s) this could expose: ignored expiration, unit conversion errors, replay of stale sessions.
- Notes: Uses a deterministic mocked clock.

### PTA-004 - Missing session secret fails closed

- Category: Configuration failure
- Priority: P0
- Type: Security
- Preconditions: A previously valid cookie exists; `SESSION_SECRET` is absent at request time.
- Steps: Send a protected request.
- Expected results: `401`; no portal or downstream access.
- Defect(s) this could expose: accepting unsigned cookies during configuration failure, startup-secret drift.
- Notes: No environment value is logged.

### PTA-005 - Valid shared cookie and active coordinator are accepted

- Category: Happy path
- Priority: P0
- Type: Positive
- Preconditions: Valid shared cookie; `PortalAuth` returns an active coordinator session.
- Steps: Send a protected request and await the authorization result.
- Expected results: `requireAuth` returns `null`; `PortalAuth` receives `{ activeOnly: true, role: "coordinator" }` exactly once.
- Defect(s) this could expose: incorrect role/status options, failure to await the second factor, false denials.
- Notes: Downstream handler behavior is tested in PTA-017.

## Phase: Portal authorization contract

### PTA-006 - Missing Identity session preserves portal 401

- Category: Authentication contract
- Priority: P0
- Type: Negative
- Preconditions: Valid shared cookie; `PortalAuth` returns a `401` response.
- Steps: Call `requireAuth`.
- Expected results: The exact `PortalAuth` response object and status are returned unchanged.
- Defect(s) this could expose: status rewriting, loss of friendly error payload, shared-cookie-only access.
- Notes: Distinguishes Identity authentication from profile authorization.

### PTA-007 - Inactive or non-coordinator profile preserves portal 403

- Category: Authorization contract
- Priority: P0
- Type: Security
- Preconditions: Valid shared cookie; `PortalAuth` returns `403` for pending, denied, suspended, or member state.
- Steps: Call `requireAuth`.
- Expected results: The exact `403` response is returned; authorization is denied.
- Defect(s) this could expose: shared password bypass of database state, treating authenticated as authorized.
- Notes: Internal state variants are already covered in the portal flow suite.

### PTA-008 - Malformed portal result fails closed

- Category: Contract integrity
- Priority: P0
- Type: Security
- Preconditions: Valid shared cookie; `PortalAuth` returns `{}` or an object without a verified profile.
- Steps: Call `requireAuth`.
- Expected results: JSON `403` with `Private tool access could not be verified.` and `Cache-Control: no-store`.
- Defect(s) this could expose: implicit authorization from a falsy/missing `response` field, dependency contract drift.
- Notes: This is a defensive assertion beyond normal `PortalAuth` behavior.

### PTA-009 - Unauthorized response wins over conflicting profile fields

- Category: Corrupted state
- Priority: P0
- Type: Security
- Preconditions: `PortalAuth` returns both an active-coordinator profile and a denial response.
- Steps: Call `requireAuth`.
- Expected results: The denial response is returned; contradictory success fields cannot override it.
- Defect(s) this could expose: ambiguous contract interpretation, privilege grant from partially corrupted results.
- Notes: Response-first handling is the fail-closed rule.

### PTA-010 - Portal dependency rejection never grants access

- Category: Dependency failure
- Priority: P0
- Type: Negative
- Preconditions: Valid shared cookie; Identity/database lookup rejects.
- Steps: Call `requireAuth` and observe the promise.
- Expected results: The rejection propagates; no authorized result is produced.
- Defect(s) this could expose: catch-and-allow behavior, swallowed database errors, fail-open outages.
- Notes: Production logging/status normalization remains an observability ambiguity.

## Phase: Shared admin-session lifecycle

### PTA-011 - Login issues cookie after both factors succeed

- Category: Session creation
- Priority: P0
- Type: Positive
- Preconditions: Correct `ADMIN_PASSWORD`; active coordinator portal session.
- Steps: `POST /api/admin/login` with the shared password.
- Expected results: `200`; `Set-Cookie` contains `dare_admin_session`; portal verification occurs before response.
- Defect(s) this could expose: cookie issuance before authorization, missing second-factor enforcement.
- Notes: Cookie HMAC and expiry are exercised by later protected calls.

### PTA-012 - Incorrect shared password is throttled and not logged

- Category: Brute-force resistance
- Priority: P0
- Type: Security
- Preconditions: Incorrect password; fake timer and log spies installed.
- Steps: Submit login, advance 800 ms, await response.
- Expected results: `401`; `PortalAuth` is not called; password/cookie data is not logged.
- Defect(s) this could expose: removed throttle, expensive dependency calls for guesses, credential leakage.
- Notes: Distributed rate limiting is not provided by this local delay.

### PTA-013 - Inactive profile receives no shared cookie

- Category: Session creation denial
- Priority: P0
- Type: Security
- Preconditions: Correct shared password; portal returns `403`.
- Steps: `POST /api/admin/login`.
- Expected results: `403`; no `Set-Cookie` header.
- Defect(s) this could expose: pending/suspended user obtaining a reusable admin session.
- Notes: Applies equally to active members who are not coordinators.

### PTA-014 - Existing session remains authenticated while access is active

- Category: Session validation
- Priority: P1
- Type: Positive
- Preconditions: Valid shared cookie and active coordinator session.
- Steps: `GET /api/admin/login`.
- Expected results: `200 {"authenticated":true}`.
- Defect(s) this could expose: false logout, failure to revalidate the portal factor.
- Notes: Used by the roster console boot flow.

### PTA-015 - Existing session becomes unauthenticated after revocation

- Category: State transition
- Priority: P0
- Type: Security
- Preconditions: Valid shared cookie; portal now denies the coordinator.
- Steps: `GET /api/admin/login`.
- Expected results: `200 {"authenticated":false}`; stale shared cookie alone is insufficient.
- Defect(s) this could expose: delayed suspension/role-removal enforcement, cached privileges.
- Notes: The next protected API call independently returns `403`.

### PTA-016 - Logout clears cookie during dependency outage

- Category: Cleanup and recovery
- Priority: P1
- Type: Positive
- Preconditions: Shared cookie exists; `PortalAuth` would reject if called.
- Steps: `POST /api/admin/logout`.
- Expected results: `200`; clearing cookie has `Max-Age=0`; portal dependency is not called.
- Defect(s) this could expose: inability to recover from stale sessions when Identity/database is down.
- Notes: No filesystem or process cleanup is part of this flow.

## Phase: Protected handler propagation

### PTA-017 - Every private-tool handler awaits authorization

- Category: Async contract
- Priority: P0
- Type: Positive
- Preconditions: Valid shared cookie and active coordinator session; downstream database is mocked.
- Steps: Send a harmless unsupported `HEAD` request to each of the five protected handlers.
- Expected results: Every handler reaches dispatch and returns `405`; `PortalAuth` runs once per request; expected handlers initialize the mocked database only after authorization.
- Defect(s) this could expose: missing `await`, returning a promise/null instead of a `Response`, one forgotten consumer.
- Notes: No domain rows, files, blobs, builds, or network calls are produced.

### PTA-018 - Every handler stops before external resources on denial

- Category: Side-effect containment
- Priority: P0
- Type: Security
- Preconditions: Valid shared cookie; portal returns `403`; database and blob APIs are spies.
- Steps: Send a request to each protected handler.
- Expected results: All return `403`; database and blob stores are untouched.
- Defect(s) this could expose: authorization after data access, partial writes/read leakage, file/blob work before denial.
- Notes: Covers file/process/stream non-occurrence at this boundary.

### PTA-019 - Protected handler exposes stable missing-session contract

- Category: Error response correctness
- Priority: P1
- Type: Negative
- Preconditions: No shared cookie.
- Steps: Call a representative protected handler.
- Expected results: JSON `401`, correct content type, `Cache-Control: no-store`, no portal or database call.
- Defect(s) this could expose: handler-specific auth drift, HTML/platform error leakage, cacheable denial.
- Notes: Other consumers share the same helper and are enumerated in PTA-018.

# Cross-cutting security, resilience, and concurrency tests

## Phase: Replay, concurrency, and dependency failure

### PTA-020 - Duplicate request revalidates revoked access

- Category: Replay and state integrity
- Priority: P0
- Type: Security
- Preconditions: First portal check is active; second check is denied; shared cookie remains valid.
- Steps: Call `requireAuth` twice with equivalent requests.
- Expected results: First returns authorized; second returns `403`; portal is called twice.
- Defect(s) this could expose: stale in-memory authorization caching, privilege persistence after suspension.
- Notes: Downstream mutation idempotency is outside this authorization diagram.

### PTA-021 - Concurrent authorization outcomes remain isolated

- Category: Concurrency
- Priority: P0
- Type: Concurrency
- Preconditions: Two valid shared-cookie requests; first portal promise resolves active, second resolves denied in the opposite completion order.
- Steps: Start both checks; resolve denial first and active second; await both.
- Expected results: The first request alone is authorized; the second receives `403`; no global result cross-talk.
- Defect(s) this could expose: shared mutable session state, response mix-up, race-dependent privilege grant.
- Notes: No locks should be required because authorization state is request-scoped.

### PTA-022 - Login dependency failure issues no cookie

- Category: Partial failure
- Priority: P0
- Type: Negative
- Preconditions: Correct shared password; `PortalAuth` rejects before session issuance.
- Steps: Submit login and await failure.
- Expected results: Rejection propagates and no success response or cookie is produced.
- Defect(s) this could expose: cookie creation before async authorization completes, partial session issuance.
- Notes: A future structured `503` must preserve this no-cookie property.

# Observability and logging assertions

- Authentication and authorization failures must not log shared passwords, signed cookies, Identity tokens, or full request headers.
- PTA-012 asserts that the current incorrect-password path emits no console log containing credentials.
- Denied requests must not touch database, blob, build-hook, filesystem, child-process, or streaming boundaries; PTA-018 asserts the relevant mocks remain unused.
- Dependency exceptions currently propagate to Netlify, which supplies platform error logging. A future handler-level log should include a correlation/request ID and error class, never secrets or raw cookie values.
- Useful production metrics would include counts of shared-password failures, missing Identity sessions, inactive-profile denials, role denials, dependency failures, and authorization latency. These metrics do not currently exist.
- `getPortalSession` is the required testability hook. Keeping it behind a single injectable/importable boundary makes status, role, outage, concurrency, and corrupted-contract cases deterministic.

# Code review risk checklist

- Confirm every protected handler uses `await requireAuth(req)` before any database, blob, build-hook, file, process, or stream work.
- Confirm a valid shared cookie is necessary but never sufficient; active coordinator database state must be checked on every request.
- Confirm denial responses are returned unchanged and malformed portal results fail closed.
- Confirm HMAC verification checks signature length before `timingSafeEqual`, validates expiration, and rejects missing `SESSION_SECRET`.
- Confirm login creates the shared cookie only after the portal authorization promise resolves successfully.
- Confirm logout remains available during Identity/database outages and always expires the cookie.
- Confirm revocation takes effect on the next request rather than at seven-day cookie expiry.
- Look for module-level mutable user/session state that could mix concurrent request outcomes.
- Look for broad catches that return success, `null`, or an empty object after Identity/database failures.
- Look for credential, cookie, token, or profile data in error logs and analytics payloads.
- Verify `401` versus `403` behavior remains consistent for UI clients and cannot be cached.
- Keep downstream file upload, photo type/size, blob rollback, build hook, and CRUD tests in their existing domain suites; do not weaken them while changing the authorization wrapper.
