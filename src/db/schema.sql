-- Promise-Keeper schema.
-- All timestamps are epoch milliseconds (INTEGER) for easy JS interop.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Commitments extracted from Slack and tracked through to ClickUp.
CREATE TABLE IF NOT EXISTS commitments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  source              TEXT    NOT NULL CHECK (source IN ('pin', 'sweep')),
  status              TEXT    NOT NULL DEFAULT 'pending_approval'
                              CHECK (status IN ('pending_approval','created','done','dismissed','snoozed')),

  -- Slack provenance
  slack_channel_id    TEXT    NOT NULL,
  slack_message_ts    TEXT    NOT NULL,
  slack_thread_ts     TEXT,
  slack_user_id       TEXT    NOT NULL,
  slack_permalink     TEXT,

  -- Extracted content
  deliverable         TEXT    NOT NULL,
  customer            TEXT,
  due_at              INTEGER,
  priority            TEXT    NOT NULL DEFAULT 'normal'
                              CHECK (priority IN ('low','normal','high','urgent')),
  confidence          REAL    NOT NULL DEFAULT 0,
  quote               TEXT    NOT NULL DEFAULT '',
  reasoning           TEXT    NOT NULL DEFAULT '',

  -- Telegram approval card
  telegram_chat_id    INTEGER,
  telegram_message_id INTEGER,

  -- ClickUp linkage
  clickup_task_id     TEXT,
  clickup_task_url    TEXT,

  -- Reminders
  snoozed_until       INTEGER,
  reminder_sent_at    INTEGER,

  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

-- One commitment per Slack message keeps the pin lane and sweep lane from
-- double-creating the same promise.
CREATE UNIQUE INDEX IF NOT EXISTS idx_commitments_slack_msg
  ON commitments (slack_channel_id, slack_message_ts);

CREATE INDEX IF NOT EXISTS idx_commitments_status ON commitments (status);
CREATE INDEX IF NOT EXISTS idx_commitments_due ON commitments (due_at);

-- Per-channel cursor for the sweep lane: the latest Slack ts we've processed.
CREATE TABLE IF NOT EXISTS channel_cursors (
  slack_channel_id  TEXT PRIMARY KEY,
  last_ts           TEXT NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- Every Slack message the sweep has already examined, so re-runs don't
-- re-extract and a pinned message isn't re-surfaced by the cron.
CREATE TABLE IF NOT EXISTS processed_messages (
  slack_channel_id  TEXT    NOT NULL,
  slack_message_ts  TEXT    NOT NULL,
  processed_at      INTEGER NOT NULL,
  PRIMARY KEY (slack_channel_id, slack_message_ts)
);

-- Maps a Slack user to the Telegram chat where their cards/reminders go.
CREATE TABLE IF NOT EXISTS user_links (
  slack_user_id     TEXT PRIMARY KEY,
  telegram_chat_id  INTEGER NOT NULL,
  display_name      TEXT,
  created_at        INTEGER NOT NULL
);

-- Append-only audit trail of every state change, for observability and demos.
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  commitment_id INTEGER,
  event         TEXT    NOT NULL,
  detail        TEXT,
  created_at    INTEGER NOT NULL
);
