-- "From the Field" trip recaps, authored in the /roster console.

CREATE TABLE field_notes (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  slug         TEXT        NOT NULL UNIQUE,
  title        TEXT        NOT NULL,
  start_date   DATE        NOT NULL,
  end_date     DATE,
  body         TEXT        NOT NULL DEFAULT '',
  status       TEXT        NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Photo binaries live in the Netlify Blobs store "field-photos" under the
-- key <note_id>/<photo_id>; this table holds the metadata.
CREATE TABLE field_note_photos (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id      UUID        NOT NULL REFERENCES field_notes(id) ON DELETE CASCADE,
  content_type TEXT        NOT NULL,
  alt          TEXT,
  is_cover     BOOLEAN     NOT NULL DEFAULT FALSE,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
