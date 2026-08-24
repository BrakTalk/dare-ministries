import test from 'node:test';
import assert from 'node:assert/strict';
import { NetlifyDB } from '@netlify/database-dev';
import {
  fallbackName,
  identityIsCoordinator,
  isUuid,
  metadataText,
  publicProfile,
} from '../netlify/functions/lib/portal-auth.mjs';
import { mergePortalIdentityRoles } from '../netlify/functions/admin-user-profiles.mjs';

test('portal authorization helpers recognize only coordinator roles', () => {
  assert.equal(identityIsCoordinator({ roles: ['member'] }), false);
  assert.equal(identityIsCoordinator({ roles: ['coordinator'] }), true);
  assert.equal(identityIsCoordinator({ roles: ['admin'] }), true);
  assert.equal(identityIsCoordinator({ role: 'coordinator' }), true);
  assert.equal(identityIsCoordinator({ role: 'admin' }), true);
  assert.equal(identityIsCoordinator({ roles: ['administrator'] }), false);
  assert.equal(identityIsCoordinator({}), false);
});

test('Identity profile helpers share metadata and fallback rules', () => {
  const user = {
    email: 'person@example.com',
    userMetadata: { full_name: '  Person Name  ', phone: '  555-0100  ' },
  };
  assert.equal(fallbackName(user), 'Person Name');
  assert.equal(metadataText(user, 'phone', 50), '555-0100');
  assert.equal(fallbackName({ email: 'fallback@example.com' }), 'fallback');
});

test('portal role synchronization preserves unrelated Identity roles', () => {
  assert.deepEqual(mergePortalIdentityRoles(['coordinator', 'member'], 'suspended'), [
    'coordinator',
    'suspended',
  ]);
  assert.deepEqual(mergePortalIdentityRoles(['member', 'member'], 'member'), ['member']);
  assert.deepEqual(mergePortalIdentityRoles(undefined, 'pending'), ['pending']);
});

test('portal profile identifiers require UUIDs', () => {
  assert.equal(isUuid('5b1a5274-8ad7-4e91-99f2-2c6cdbf7d55f'), true);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid('5b1a5274-8ad7-4e91-19f2-2c6cdbf7d55f'), false);
});

test('public profile responses do not expose Identity or review internals', () => {
  const result = publicProfile({
    id: 'profile-id',
    identity_user_id: 'secret-identity-id',
    email: 'person@example.com',
    display_name: 'Person',
    status: 'pending',
    role: 'member',
    reviewed_by: 'private-reviewer-id',
  });

  assert.equal(result.email, 'person@example.com');
  assert.equal(result.identity_user_id, undefined);
  assert.equal(result.reviewed_by, undefined);
});

test('all database migrations apply and portal profile constraints hold', async () => {
  const db = new NetlifyDB({ logger: () => {} });
  await db.start();

  try {
    const migrations = await db.applyMigrations('netlify/database/migrations');
    assert.ok(migrations.some((name) => name.includes('create_user_profiles')));

    const inserted = await db.query(
      `INSERT INTO user_profiles (identity_user_id, email, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, status, role`,
      ['identity-123', 'person@example.com', 'Person']
    );
    assert.equal(inserted.rows[0].status, 'pending');
    assert.equal(inserted.rows[0].role, 'member');

    await assert.rejects(
      db.query(
        `INSERT INTO user_profiles (identity_user_id, email, display_name, status)
         VALUES ($1, $2, $3, $4)`,
        ['identity-456', 'invalid@example.com', 'Invalid', 'unreviewed']
      )
    );

    const audit = await db.query(
      `INSERT INTO portal_audit_log (target_profile_id, action, details)
       VALUES ($1, $2, $3::JSONB)
       RETURNING action`,
      [inserted.rows[0].id, 'approve', JSON.stringify({ status: 'active' })]
    );
    assert.equal(audit.rows[0].action, 'approve');
  } finally {
    await db.stop();
  }
});
