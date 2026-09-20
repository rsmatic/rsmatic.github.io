-- Lets the invitation hide the age, or show your own wording in its place
-- ("Fourtis" instead of "41").
--
--   npx wrangler d1 execute aby41 --remote --file=worker/migrations/0002-age-label.sql --config worker/wrangler.toml
--
-- Run once. A second run fails with "duplicate column name", which just
-- means it is already applied.

ALTER TABLE events ADD COLUMN ageDisplay TEXT;
ALTER TABLE events ADD COLUMN ageLabel TEXT;

UPDATE events SET ageDisplay = 'number' WHERE ageDisplay IS NULL OR ageDisplay = '';
