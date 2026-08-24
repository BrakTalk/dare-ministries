// Netlify Identity lifecycle hooks. A confirmed signup is recorded immediately
// so coordinators can review it even before the person first opens the portal.

import { getDatabase } from '@netlify/database';
import { cleanText, notify } from './lib/helpers.mjs';

function metadataText(user, key, maxLength) {
  return cleanText(user?.userMetadata?.[key], maxLength);
}

function displayName(user) {
  return (
    metadataText(user, 'full_name', 200) ||
    metadataText(user, 'name', 200) ||
    cleanText(user?.email?.split('@')[0], 200) ||
    'Portal member'
  );
}

export default {
  async userSignup(event) {
    const user = event.user;
    const email = cleanText(user.email, 320);
    if (!email) return;

    const db = getDatabase();
    await db.sql`
      INSERT INTO user_profiles (
        identity_user_id,
        email,
        display_name,
        phone,
        organization,
        request_reason
      )
      VALUES (
        ${user.id},
        ${email.toLowerCase()},
        ${displayName(user)},
        ${metadataText(user, 'phone', 50)},
        ${metadataText(user, 'organization', 200)},
        ${metadataText(user, 'request_reason', 2000)}
      )
      ON CONFLICT (identity_user_id) DO UPDATE SET
        email = EXCLUDED.email,
        updated_at = NOW()
    `;

    await notify(
      `Portal access request: ${displayName(user)}`,
      [
        `${displayName(user)} has confirmed their email and requested access to the D.A.R.E. Volunteer Portal.`,
        '',
        `Email: ${email}`,
        `Phone: ${metadataText(user, 'phone', 50) || 'Not provided'}`,
        `Organization: ${metadataText(user, 'organization', 200) || 'Not provided'}`,
        `Connection to D.A.R.E.: ${metadataText(user, 'request_reason', 2000) || 'Not provided'}`,
        '',
        'Sign in to the Volunteer Portal to review this request.',
      ].join('\n')
    );

    const existingRoles = Array.isArray(user.appMetadata?.roles) ? user.appMetadata.roles : [];
    return {
      user: {
        ...user,
        appMetadata: {
          ...(user.appMetadata || {}),
          roles: existingRoles.length ? existingRoles : ['pending'],
        },
      },
    };
  },

  async userDeleted(event) {
    const db = getDatabase();
    await db.sql`
      UPDATE user_profiles
      SET identity_deleted_at = NOW(), status = 'suspended', updated_at = NOW()
      WHERE identity_user_id = ${event.user.id}
    `;
  },
};
