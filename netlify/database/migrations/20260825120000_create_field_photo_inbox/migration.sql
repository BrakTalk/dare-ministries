-- Email-driven photo intake for the coordinator Photo Inbox.
-- Originals are never published directly: sanitized images live in the
-- "field-photo-inbox" Blob store until a coordinator promotes them into the
-- existing field_note_photos / "field-photos" publication path.

ALTER TABLE field_note_photos
  ADD COLUMN captured_at_local TIMESTAMP,
  ADD COLUMN captured_offset_minutes SMALLINT
    CHECK (captured_offset_minutes BETWEEN -840 AND 840),
  ADD COLUMN captured_date DATE,
  ADD COLUMN location_label TEXT,
  ADD COLUMN metadata_source TEXT
    CHECK (metadata_source IN ('exif', 'email', 'coordinator'));

CREATE TABLE field_photo_submissions (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  provider           TEXT        NOT NULL DEFAULT 'resend',
  provider_event_id  TEXT        NOT NULL UNIQUE,
  provider_email_id  TEXT        NOT NULL UNIQUE,
  sender_name        TEXT,
  sender_email       TEXT        NOT NULL,
  recipient          TEXT        NOT NULL,
  subject            TEXT,
  status             TEXT        NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'ready', 'partial', 'approved', 'rejected', 'failed', 'no_photos')),
  failure_reason     TEXT,
  received_at        TIMESTAMPTZ NOT NULL,
  reviewed_by        UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  reviewed_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE field_photo_submission_files (
  id                       UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id            UUID        NOT NULL REFERENCES field_photo_submissions(id) ON DELETE CASCADE,
  provider_attachment_id   TEXT        NOT NULL,
  original_filename        TEXT,
  declared_content_type    TEXT,
  content_type             TEXT,
  byte_size                INTEGER     CHECK (byte_size >= 0),
  width                     INTEGER     CHECK (width > 0),
  height                    INTEGER     CHECK (height > 0),
  sha256                    TEXT,
  inbox_blob_key           TEXT,
  thumbnail_blob_key       TEXT,
  captured_at_local        TIMESTAMP,
  captured_offset_minutes  SMALLINT
    CHECK (captured_offset_minutes BETWEEN -840 AND 840),
  captured_date            DATE,
  gps_latitude             NUMERIC(9, 6)
    CHECK (gps_latitude BETWEEN -90 AND 90),
  gps_longitude            NUMERIC(9, 6)
    CHECK (gps_longitude BETWEEN -180 AND 180),
  location_label           TEXT,
  alt                      TEXT,
  exif_subset              JSONB       NOT NULL DEFAULT '{}'::JSONB,
  status                   TEXT        NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'ready', 'approved', 'rejected', 'failed')),
  failure_reason           TEXT,
  approved_photo_id        UUID        REFERENCES field_note_photos(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (submission_id, provider_attachment_id)
);

CREATE TABLE field_photo_submission_events (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id     UUID        NOT NULL REFERENCES field_photo_submissions(id) ON DELETE CASCADE,
  actor_profile_id  UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  action            TEXT        NOT NULL,
  details           JSONB       NOT NULL DEFAULT '{}'::JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX field_photo_submissions_status_received_idx
  ON field_photo_submissions (status, received_at DESC);

CREATE INDEX field_photo_submission_files_submission_status_idx
  ON field_photo_submission_files (submission_id, status, captured_date);

CREATE INDEX field_photo_submission_files_hash_idx
  ON field_photo_submission_files (sha256)
  WHERE sha256 IS NOT NULL;

CREATE INDEX field_photo_submission_events_submission_created_idx
  ON field_photo_submission_events (submission_id, created_at DESC);
