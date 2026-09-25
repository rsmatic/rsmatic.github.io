-- Lets the host pause every link of an event — for invitations sent out
-- before the event was ready. A paused link shows only the host's message.
--
--   npx wrangler d1 execute aby41 --remote --file=worker/migrations/0006-invite-pause.sql --config worker/wrangler.toml
--
-- Run once. A second run fails with "duplicate column name", which just
-- means it is already applied.

ALTER TABLE events ADD COLUMN inviteStatus TEXT;
ALTER TABLE events ADD COLUMN pausedMessage TEXT;

UPDATE events SET inviteStatus = 'open' WHERE inviteStatus IS NULL OR inviteStatus = '';
