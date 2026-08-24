# Private-tool coordinator authorization — sequence-derived test spec

Runnable suite: `netlify/functions/__tests__/roster-auth-gating.test.ts`.

## System model

- `NetlifyIdentity` proves the visitor's identity through the `nf_jwt` session.
- `PortalAuth` reconciles that trusted Identity subject to `user_profiles` and is
  authoritative for D.A.R.E. status and role.
- `getCoordinatorSession()` requests `{ activeOnly: true, role: 'coordinator' }`
  and accepts only a returned `active/coordinator` profile.
- `requireAuth(req)` protects `/api/admin/volunteers`, `/api/admin/contacts`,
  `/api/admin/impact-stats`, `/api/admin/field-notes`, and
  `/api/admin/field-note-photos`.
- `GET /api/admin/session` is the roster boot check. It returns a minimal
  coordinator profile with `Cache-Control: no-store`.
- Published field-note photos are public. Draft-photo reads use the same
  coordinator authorization and translate denial to `404` so draft state is not
  disclosed.
- There is no shared roster password, HMAC secret, or `dare_admin_session`
  cookie.

## Security contracts

- Missing Identity authentication returns the PortalAuth `401` unchanged.
- Pending, denied, suspended, or ordinary member accounts return `403`.
- A malformed or contradictory session object fails closed; a denial response
  always takes precedence over profile-looking fields.
- Identity/database dependency failures may propagate as server failures but
  must never be converted into authorization.
- Authorization is revalidated on every private request. Role removal or
  suspension therefore applies on the next request.
- `POST`, `PUT`, `PATCH`, and `DELETE` requests require an exact same-origin
  `Origin` header after coordinator verification and before domain access.
- `GET`, `HEAD`, and `OPTIONS` do not require `Origin` so ordinary navigation,
  image loading, and read-only calls continue to work.
- Authentication and authorization responses are not cacheable.
- Identity tokens, cookies, credentials, and full request headers must never be
  logged.

## Phase: Coordinator authorization contract

### PTA-001 — Active coordinator is accepted without a legacy cookie

- Preconditions: PortalAuth returns an `active/coordinator` session.
- Expected: `requireAuth` returns `null`; PortalAuth receives
  `{activeOnly:true, role:'coordinator'}` once; no origin check for GET.

### PTA-002 — Missing Identity session preserves 401

- Preconditions: PortalAuth returns `401 Please sign in to continue.`.
- Expected: exact response and `no-store` header are returned; no domain access.

### PTA-003 — Inactive or non-coordinator profile preserves 403

- Preconditions: PortalAuth denies a pending, denied, suspended, or member
  profile.
- Expected: exact denial is returned; no authorization is inferred from an
  authenticated Identity subject alone.

### PTA-004 — Malformed coordinator session fails closed

- Preconditions: PortalAuth returns `{}` or omits the verified profile.
- Expected: `403 Private tool access could not be verified.`.

### PTA-005 — Denial response wins over conflicting profile data

- Preconditions: result contains both a denial response and coordinator-looking
  fields.
- Expected: denial is returned and success fields are discarded.

### PTA-006 — Dependency rejection cannot grant access

- Preconditions: Identity or database lookup rejects.
- Expected: rejection propagates; no authorized result or downstream call.

## Phase: Same-origin mutation protection

### PTA-007 — Mutation checks origin after coordinator verification

- Preconditions: active coordinator; same-origin POST.
- Expected: coordinator check runs first, origin check runs once, request may
  continue.

### PTA-008 — Missing or foreign Origin is rejected

- Preconditions: active coordinator; POST has no Origin or a different origin.
- Expected: `403` before domain database/blob access.

### PTA-009 — Same-origin mutation reaches its handler

- Preconditions: active coordinator; exact production Origin; valid payload.
- Expected: normal handler response and expected database call.

## Phase: Coordinator session endpoint

### PTA-010 — Boot check returns minimal coordinator profile

- Request: `GET /api/admin/session`.
- Expected: `200`, `authenticated:true`, display name, email, active status,
  coordinator role, and `Cache-Control: no-store`.
- Excluded: Identity subject, review metadata, tokens, and database internals.

### PTA-011 — Boot check preserves authorization denial

- Preconditions: PortalAuth returns `401` or `403`.
- Expected: exact denial response is returned so the UI can distinguish sign-in
  from access denied.

### PTA-012 — Session endpoint is read-only

- Request: any non-GET method.
- Expected: `405 no-store`; Identity/database authorization is not invoked.

## Phase: Protected-handler propagation

### PTA-013 — Every private handler awaits authorization

- Expected: all five private handler families call PortalAuth before dispatching
  their method logic.

### PTA-014 — Denial stops every private handler

- Preconditions: coordinator check returns `403`.
- Expected: all handlers return `403`; no domain database or blob calls.

### PTA-015 — Anonymous private request has a stable 401 contract

- Preconditions: no valid Identity session.
- Expected: PortalAuth `401` with `no-store`; no domain access.

## Phase: Revocation, concurrency, and legacy removal

### PTA-016 — Duplicate request revalidates authorization

- Preconditions: first check active, second check denied.
- Expected: first request succeeds; second returns `403`; no cached privilege.

### PTA-017 — Concurrent outcomes remain isolated

- Preconditions: one active and one denied authorization resolve out of order.
- Expected: each request receives its own result without shared mutable state.

### PTA-018 — Shared credential contract is absent

- Expected source invariants: no `ADMIN_PASSWORD`, `SESSION_SECRET`,
  `dare_admin_session`, or `/api/admin/login` in the authorization/session
  implementation.

## Browser authorization states

The roster client suite additionally verifies:

- Anonymous boot redirects to `/login/?next=/roster/`.
- Centralized sign-in honors only the exact allowlisted `/roster/` destination;
  external, protocol-relative, and unrecognized paths fall back to `/portal/`.
- Signed-in non-coordinators remain on `/roster/` and see an access-denied state,
  avoiding a login loop.
- Dependency failure produces an unavailable state rather than an authorization
  denial.
- Mid-operation `401` and `403` close all private overlays before navigation or
  denial rendering.
- Sign-out uses Netlify Identity and returns to `/login/?signedOut=1`.

## Review checklist

- Confirm every private handler awaits `requireAuth(req)` before domain access.
- Confirm mutation authorization cannot be bypassed with a missing or foreign
  Origin header.
- Confirm draft-photo denials remain `404` and are never CDN-cacheable.
- Confirm `401` versus `403` behavior remains distinct and `no-store`.
- Confirm role removal is effective on the next request.
- Confirm the roster contains no independent credential form or shared secret.
- Confirm production has at least one tested coordinator account before removing
  legacy environment variables.
