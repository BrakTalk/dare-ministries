// /api/admin/user-profiles — coordinator review of portal account requests.

import { admin as identityAdmin } from '@netlify/identity';
import { json, readBody, cleanText } from './lib/helpers.mjs';
import { getPortalSession, isUuid, requireSameOrigin } from './lib/portal-auth.mjs';

export const config = { path: '/api/admin/user-profiles' };

const ACTIONS = {
  approve: { status: 'active', identityRole: 'member' },
  deny: { status: 'denied', identityRole: 'pending' },
  suspend: { status: 'suspended', identityRole: 'suspended' },
  reactivate: { status: 'active', identityRole: 'member' },
};

function coordinatorProfile(row) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    phone: row.phone,
    organization: row.organization,
    request_reason: row.request_reason,
    status: row.status,
    role: row.role,
    decision_message: row.decision_message,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}

export default async (req) => {
  const session = await getPortalSession({ activeOnly: true, role: 'coordinator' });
  if (session.response) return session.response;

  if (req.method === 'GET') {
    const rows = await session.db.sql`
      SELECT *
      FROM user_profiles
      WHERE identity_deleted_at IS NULL
      ORDER BY
        CASE status WHEN 'pending' THEN 0 ELSE 1 END,
        created_at DESC
    `;
    return json({ profiles: rows.map(coordinatorProfile) }, 200, { 'Cache-Control': 'no-store' });
  }

  if (req.method === 'PATCH') {
    const invalidOrigin = requireSameOrigin(req);
    if (invalidOrigin) return invalidOrigin;

    const body = await readBody(req);
    if (!body || !isUuid(body.id) || !ACTIONS[body.action]) {
      return json({ error: 'A valid account and action are required.' }, 400);
    }

    const targetRows = await session.db.sql`
      SELECT * FROM user_profiles WHERE id = ${body.id} AND identity_deleted_at IS NULL
    `;
    const target = targetRows[0];
    if (!target) return json({ error: 'Account not found.' }, 404);
    if (target.role === 'coordinator') {
      return json({ error: 'Coordinator access must be managed in Netlify Identity.' }, 400);
    }

    const action = ACTIONS[body.action];
    const decisionMessage = cleanText(body.decision_message, 1000);
    const rows = await session.db.sql`
      UPDATE user_profiles
      SET
        status = ${action.status},
        decision_message = ${decisionMessage},
        reviewed_by = ${session.profile.id},
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE id = ${target.id}
      RETURNING *
    `;

    await session.db.sql`
      INSERT INTO portal_audit_log (actor_profile_id, target_profile_id, action, details)
      VALUES (
        ${session.profile.id},
        ${target.id},
        ${body.action},
        ${JSON.stringify({ status: action.status, decision_message: decisionMessage })}::JSONB
      )
    `;

    // Keep Netlify's role metadata useful for future edge gating. The database
    // status above remains authoritative, so a failed metadata sync never
    // grants access or rolls back the coordinator's decision.
    let identitySynced = true;
    try {
      const identityUser = await identityAdmin.getUser(target.identity_user_id);
      await identityAdmin.updateUser(target.identity_user_id, {
        app_metadata: {
          ...(identityUser.appMetadata || {}),
          roles: [action.identityRole],
        },
      });
    } catch (err) {
      identitySynced = false;
      console.error('Could not sync portal role to Netlify Identity:', err);
    }

    return json(
      { ok: true, profile: coordinatorProfile(rows[0]), identity_synced: identitySynced },
      200,
      { 'Cache-Control': 'no-store' }
    );
  }

  return json({ error: 'Method not allowed.' }, 405);
};
