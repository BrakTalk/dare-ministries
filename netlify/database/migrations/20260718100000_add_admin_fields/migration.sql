-- Fields for the roster admin console (/roster):
-- volunteer follow-up workflow and contact inbox read tracking.

ALTER TABLE volunteers
  ADD COLUMN status TEXT NOT NULL DEFAULT 'new'
  CHECK (status IN ('new', 'contacted', 'active', 'inactive'));

ALTER TABLE contacts
  ADD COLUMN read_at TIMESTAMPTZ;
