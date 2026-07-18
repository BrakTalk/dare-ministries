-- D.A.R.E. Ministries — core tables
-- Ported from docs/supabase-schema.sql. The database is only accessible from
-- Netlify Functions (server-side), so no row-level security is needed here.

CREATE TABLE volunteers (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  phone         TEXT,
  organization  TEXT,
  skills        TEXT,
  availability  TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE contacts (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT        NOT NULL,
  email      TEXT        NOT NULL,
  subject    TEXT,
  message    TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Single-row table for site-wide impact statistics.
-- Enforced to always have exactly one row (id = 1).
CREATE TABLE impact_stats (
  id                     INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  homes_repaired         INTEGER DEFAULT 0,
  volunteer_hours        INTEGER DEFAULT 0,
  deployments_completed  INTEGER DEFAULT 0,
  partner_organizations  INTEGER DEFAULT 0,
  families_helped        INTEGER DEFAULT 0,
  years_of_service       INTEGER DEFAULT 0,
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with PLACEHOLDER/TEST data.
-- Replace with real numbers from Leonard before public launch.
INSERT INTO impact_stats (
  homes_repaired,
  volunteer_hours,
  deployments_completed,
  partner_organizations,
  families_helped,
  years_of_service
) VALUES (
  150,   -- PLACEHOLDER — confirm with Leonard
  8500,  -- PLACEHOLDER — confirm with Leonard
  120,   -- PLACEHOLDER — confirm with Leonard
  30,    -- confirmed: 30+ partner organizations
  175,   -- PLACEHOLDER — confirm with Leonard
  21     -- confirmed: founded 2004, active through 2026
);
