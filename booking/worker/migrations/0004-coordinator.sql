-- Gives each event its own coordinator key: a second, much smaller login
-- that can manage guests and seats but nothing else.
--
--   npx wrangler d1 execute aby41 --remote --file=worker/migrations/0004-coordinator.sql --config worker/wrangler.toml
--
-- Run once. A second run fails with "duplicate column name", which just
-- means it is already applied.

ALTER TABLE events ADD COLUMN coordinatorKey TEXT;

CREATE INDEX IF NOT EXISTS idx_events_coordinator ON events (coordinatorKey);
