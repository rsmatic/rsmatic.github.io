-- Aby's 41st — schema para sa Cloudflare D1.
-- Patakbuhin:  npx wrangler d1 execute aby41 --remote --file=worker/schema.sql

CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  celebrant    TEXT,
  nickname     TEXT,
  birthDate    TEXT,
  eventDate    TEXT NOT NULL,
  startTime    TEXT,
  venue        TEXT,
  venueMapUrl  TEXT,
  dressCode    TEXT,
  note         TEXT,
  rsvpDeadline TEXT,
  hostName     TEXT,
  theme        TEXT,
  ageDisplay   TEXT,
  ageLabel     TEXT,
  seatDisplay  TEXT,
  inviteStatus TEXT,
  pausedMessage TEXT,
  photoShape   TEXT,
  photoSize    TEXT,
  borderStyle  TEXT,
  cardCorners  TEXT,
  cardAlign    TEXT,
  accentColor  TEXT,
  borderColor  TEXT,
  photoUpdatedAt TEXT,
  coordinatorKey TEXT,
  createdAt    TEXT
);

CREATE TABLE IF NOT EXISTS slots (
  id           TEXT PRIMARY KEY,
  eventId      TEXT NOT NULL,
  tableName    TEXT,
  seat         TEXT,
  label        TEXT,
  guestName    TEXT,
  guestContact TEXT,
  token        TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'open',
  reason       TEXT,
  message      TEXT,
  respondedAt  TEXT,
  createdAt    TEXT
);

CREATE TABLE IF NOT EXISTS event_photos (
  eventId   TEXT PRIMARY KEY,
  mime      TEXT NOT NULL,
  data      TEXT NOT NULL,
  updatedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_slots_event ON slots (eventId);
CREATE INDEX IF NOT EXISTS idx_slots_token ON slots (token);
CREATE INDEX IF NOT EXISTS idx_events_coordinator ON events (coordinatorKey);

-- Ang event ni Aby, handa na.
INSERT OR IGNORE INTO events
  (id, title, celebrant, nickname, birthDate, eventDate, startTime, venue, venueMapUrl,
   dressCode, note, rsvpDeadline, hostName, theme, ageDisplay, ageLabel, seatDisplay,
   inviteStatus, pausedMessage,
   photoShape, photoSize, borderStyle, cardCorners, cardAlign, accentColor, borderColor,
   photoUpdatedAt, coordinatorKey, createdAt)
VALUES
  ('evt_aby41', 'Aby''s 41st Birthday', 'Mary Abegail Matic', 'Aby', '1985-10-25', '2026-10-25',
   '18:00', '', '', '', '', '2026-10-18', 'Rexter Matic', 'rose-gold', 'number', '', 'full', 'open', '',
   'circle', 'medium', 'double', 'soft', 'center', '', '', '', '',
   '2026-09-20T00:00:00.000Z');
