-- Adds the theme picker and the venue map link to an events table that
-- was created before they existed.
--
--   npx wrangler d1 execute aby41 --remote --file=worker/migrations/0001-theme-and-map.sql --config worker/wrangler.toml
--
-- Run once. SQLite has no ADD COLUMN IF NOT EXISTS, so a second run fails
-- with "duplicate column name" — which is harmless, it just means the
-- migration is already applied.

ALTER TABLE events ADD COLUMN venueMapUrl TEXT;
ALTER TABLE events ADD COLUMN theme TEXT;

UPDATE events SET theme = 'rose-gold' WHERE theme IS NULL OR theme = '';
