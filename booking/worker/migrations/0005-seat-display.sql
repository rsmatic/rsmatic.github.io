-- Lets the invitation hide the seat numbers, or show only how many seats
-- are held, instead of naming each one.
--
--   npx wrangler d1 execute aby41 --remote --file=worker/migrations/0005-seat-display.sql --config worker/wrangler.toml
--
-- Run once. A second run fails with "duplicate column name", which just
-- means it is already applied.

ALTER TABLE events ADD COLUMN seatDisplay TEXT;

UPDATE events SET seatDisplay = 'full' WHERE seatDisplay IS NULL OR seatDisplay = '';
