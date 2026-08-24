-- Individual portal accounts. Netlify Identity owns credentials; this table
-- stores D.A.R.E.-specific profile information, approval state, and access.
CREATE TABLE user_profiles (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  identity_user_id    TEXT        NOT NULL UNIQUE,
  email               TEXT        NOT NULL,
  display_name        TEXT        NOT NULL,
  phone               TEXT,
  organization        TEXT,
  request_reason      TEXT,
  status              TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'denied', 'suspended')),
  role                TEXT        NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'coordinator')),
  decision_message    TEXT,
  reviewed_by         UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  identity_deleted_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX user_profiles_status_created_idx
  ON user_profiles (status, created_at DESC);

CREATE INDEX user_profiles_role_idx
  ON user_profiles (role);

-- Records coordinator decisions even if the affected account is later removed.
CREATE TABLE portal_audit_log (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_profile_id  UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  target_profile_id UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  action            TEXT        NOT NULL,
  details           JSONB       NOT NULL DEFAULT '{}'::JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX portal_audit_log_created_idx
  ON portal_audit_log (created_at DESC);
