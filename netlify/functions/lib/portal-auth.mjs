// Shared authentication and authorization for the Volunteer Portal.
// Netlify Identity proves who the visitor is; user_profiles controls what that
// person may access inside D.A.R.E.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { json, cleanText } from './helpers.mjs';

const COORDINATOR_IDENTITY_ROLES = new Set(['admin', 'coordinator']);

export function identityIsCoordinator(user) {
  return (
    COORDINATOR_IDENTITY_ROLES.has(user?.role) ||
    (Array.isArray(user?.roles) && user.roles.some((role) => COORDINATOR_IDENTITY_ROLES.has(role)))
  );
}

export function metadataText(user, key, maxLength) {
  return cleanText(user?.userMetadata?.[key], maxLength);
}

export function fallbackName(user) {
  return (
    metadataText(user, 'full_name', 200) ||
    metadataText(user, 'name', 200) ||
    cleanText(user?.email?.split('@')[0], 200) ||
    'Portal member'
  );
}

export async function getOrCreateProfile(user, db = getDatabase()) {
  const coordinator = identityIsCoordinator(user);
  const email = cleanText(user.email, 320);
  if (!email) throw new Error('The signed-in Identity account has no email address.');

  const rows = await db.sql`
    INSERT INTO user_profiles (
      identity_user_id,
      email,
      display_name,
      phone,
      organization,
      request_reason,
      status,
      role,
      last_login_at
    )
    VALUES (
      ${user.id},
      ${email.toLowerCase()},
      ${fallbackName(user)},
      ${metadataText(user, 'phone', 50)},
      ${metadataText(user, 'organization', 200)},
      ${metadataText(user, 'request_reason', 2000)},
      ${coordinator ? 'active' : 'pending'},
      ${coordinator ? 'coordinator' : 'member'},
      NOW()
    )
    ON CONFLICT (identity_user_id) DO UPDATE SET
      email = EXCLUDED.email,
      role = CASE
        WHEN ${coordinator} THEN 'coordinator'
        WHEN user_profiles.role = 'coordinator' THEN 'member'
        ELSE user_profiles.role
      END,
      status = CASE
        WHEN ${coordinator} THEN 'active'
        WHEN user_profiles.role = 'coordinator' THEN 'suspended'
        ELSE user_profiles.status
      END,
      last_login_at = NOW(),
      updated_at = NOW()
    RETURNING *
  `;

  return rows[0];
}

export async function getPortalSession(options = {}) {
  const user = await getUser();
  if (!user) {
    return {
      response: json({ error: 'Please sign in to continue.' }, 401, {
        'Cache-Control': 'no-store',
      }),
    };
  }

  const db = getDatabase();
  const profile = await getOrCreateProfile(user, db);

  if (options.activeOnly && profile.status !== 'active') {
    return {
      response: json({ error: 'This account does not currently have access.' }, 403, {
        'Cache-Control': 'no-store',
      }),
    };
  }

  if (options.role && profile.role !== options.role) {
    return {
      response: json({ error: 'You do not have permission to use this area.' }, 403, {
        'Cache-Control': 'no-store',
      }),
    };
  }

  return { user, profile, db };
}

export function requireSameOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) {
    return json({ error: 'Request origin is required.' }, 403, { 'Cache-Control': 'no-store' });
  }

  let requestOrigin;
  try {
    requestOrigin = new URL(req.url).origin;
  } catch {
    return json({ error: 'Invalid request URL.' }, 400, { 'Cache-Control': 'no-store' });
  }

  if (origin !== requestOrigin) {
    return json({ error: 'Request origin is not allowed.' }, 403, { 'Cache-Control': 'no-store' });
  }
  return null;
}

export function publicProfile(profile) {
  return {
    id: profile.id,
    email: profile.email,
    display_name: profile.display_name,
    phone: profile.phone,
    organization: profile.organization,
    request_reason: profile.request_reason,
    status: profile.status,
    role: profile.role,
    decision_message: profile.decision_message,
    reviewed_at: profile.reviewed_at,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  };
}

export function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
