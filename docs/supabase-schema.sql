-- D.A.R.E. Ministries — Supabase Schema
-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Tables ───────────────────────────────────────────────────────────────────

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
-- To reset: run the UPDATE block in the "Reset" section below.
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

-- ─── Reset to Zero (run when Leonard provides real numbers) ───────────────────
-- Uncomment and run this block to wipe test data before entering real figures:
--
-- UPDATE impact_stats SET
--   homes_repaired        = 0,
--   volunteer_hours       = 0,
--   deployments_completed = 0,
--   partner_organizations = 0,
--   families_helped       = 0,
--   years_of_service      = 0,
--   updated_at            = NOW()
-- WHERE id = 1;

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Enable RLS on all tables (blocks everything by default, then we open only
-- what the public site needs).

ALTER TABLE volunteers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE impact_stats ENABLE ROW LEVEL SECURITY;

-- volunteers: anyone can submit the signup form; no one can read the roster
-- (Leonard reads it in Supabase Studio, which uses the service role key).
CREATE POLICY "Public can submit volunteer form"
  ON volunteers FOR INSERT TO anon WITH CHECK (true);

-- contacts: anyone can submit the contact form; no one can read submissions.
CREATE POLICY "Public can submit contact form"
  ON contacts FOR INSERT TO anon WITH CHECK (true);

-- impact_stats: public read-only (powers the live impact counter on the site).
-- Only Leonard (via Supabase Studio) can update the numbers.
CREATE POLICY "Public can read impact stats"
  ON impact_stats FOR SELECT TO anon USING (true);
