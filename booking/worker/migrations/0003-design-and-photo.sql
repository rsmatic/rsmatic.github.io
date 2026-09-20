-- Adds the invitation design options and the uploaded photo.
--
--   npx wrangler d1 execute aby41 --remote --file=worker/migrations/0003-design-and-photo.sql --config worker/wrangler.toml
--
-- Run once. A second run fails with "duplicate column name", which just
-- means it is already applied.

ALTER TABLE events ADD COLUMN photoShape TEXT;
ALTER TABLE events ADD COLUMN photoSize TEXT;
ALTER TABLE events ADD COLUMN borderStyle TEXT;
ALTER TABLE events ADD COLUMN cardCorners TEXT;
ALTER TABLE events ADD COLUMN cardAlign TEXT;
ALTER TABLE events ADD COLUMN accentColor TEXT;
ALTER TABLE events ADD COLUMN borderColor TEXT;
ALTER TABLE events ADD COLUMN photoUpdatedAt TEXT;

UPDATE events SET
  photoShape  = COALESCE(NULLIF(photoShape, ''), 'circle'),
  photoSize   = COALESCE(NULLIF(photoSize, ''), 'medium'),
  borderStyle = COALESCE(NULLIF(borderStyle, ''), 'double'),
  cardCorners = COALESCE(NULLIF(cardCorners, ''), 'soft'),
  cardAlign   = COALESCE(NULLIF(cardAlign, ''), 'center');

CREATE TABLE IF NOT EXISTS event_photos (
  eventId   TEXT PRIMARY KEY,
  mime      TEXT NOT NULL,
  data      TEXT NOT NULL,
  updatedAt TEXT
);
