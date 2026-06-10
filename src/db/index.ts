import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type {
  CommitmentRow,
  CommitmentStatus,
  ExtractedCommitment,
  Source,
  UserLinkRow,
} from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));

function openDb(): Database.Database {
  mkdirSync(dirname(resolve(config.DATABASE_PATH)), { recursive: true });
  const db = new Database(config.DATABASE_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(resolve(here, 'schema.sql'), 'utf8');
  db.exec(schema);
  logger.debug({ path: config.DATABASE_PATH }, 'database ready');
  return db;
}

export const db = openDb();

const now = (): number => Date.now();

// ---- audit ----

const insertAudit = db.prepare(
  `INSERT INTO audit_log (commitment_id, event, detail, created_at) VALUES (?, ?, ?, ?)`,
);

export function audit(event: string, commitmentId: number | null, detail?: unknown): void {
  insertAudit.run(commitmentId, event, detail === undefined ? null : JSON.stringify(detail), now());
}

// ---- commitments ----

export interface NewCommitment {
  source: Source;
  slackChannelId: string;
  slackMessageTs: string;
  slackThreadTs: string | null;
  slackUserId: string;
  slackPermalink: string | null;
  extracted: ExtractedCommitment;
  dueAt: number | null;
}

const insertCommitment = db.prepare(`
  INSERT INTO commitments (
    source, status,
    slack_channel_id, slack_message_ts, slack_thread_ts, slack_user_id, slack_permalink,
    deliverable, customer, due_at, priority, confidence, quote, reasoning,
    created_at, updated_at
  ) VALUES (
    @source, 'pending_approval',
    @slack_channel_id, @slack_message_ts, @slack_thread_ts, @slack_user_id, @slack_permalink,
    @deliverable, @customer, @due_at, @priority, @confidence, @quote, @reasoning,
    @created_at, @updated_at
  )
`);

/**
 * Insert a commitment. Returns the new row, or null if one already exists for
 * the same Slack message (the unique index makes this idempotent across the
 * pin and sweep lanes).
 */
export function createCommitment(c: NewCommitment): CommitmentRow | null {
  const ts = now();
  try {
    const info = insertCommitment.run({
      source: c.source,
      slack_channel_id: c.slackChannelId,
      slack_message_ts: c.slackMessageTs,
      slack_thread_ts: c.slackThreadTs,
      slack_user_id: c.slackUserId,
      slack_permalink: c.slackPermalink,
      deliverable: c.extracted.deliverable,
      customer: c.extracted.customer,
      due_at: c.dueAt,
      priority: c.extracted.priority,
      confidence: c.extracted.confidence,
      quote: c.extracted.quote,
      reasoning: c.extracted.reasoning,
      created_at: ts,
      updated_at: ts,
    });
    const row = getCommitment(Number(info.lastInsertRowid));
    if (row) audit('commitment_created', row.id, { source: c.source });
    return row;
  } catch (err) {
    // UNIQUE violation → this Slack message already produced a commitment.
    if (err instanceof Error && /UNIQUE/.test(err.message)) {
      logger.debug(
        { channel: c.slackChannelId, ts: c.slackMessageTs },
        'duplicate commitment ignored',
      );
      return null;
    }
    throw err;
  }
}

const selectById = db.prepare(`SELECT * FROM commitments WHERE id = ?`);
export function getCommitment(id: number): CommitmentRow | null {
  return (selectById.get(id) as CommitmentRow | undefined) ?? null;
}

const updateStatusStmt = db.prepare(
  `UPDATE commitments SET status = ?, updated_at = ? WHERE id = ?`,
);
export function setStatus(id: number, status: CommitmentStatus): void {
  updateStatusStmt.run(status, now(), id);
  audit('status_changed', id, { status });
}

const setTelegramCardStmt = db.prepare(
  `UPDATE commitments SET telegram_chat_id = ?, telegram_message_id = ?, updated_at = ? WHERE id = ?`,
);
export function setTelegramCard(id: number, chatId: number, messageId: number): void {
  setTelegramCardStmt.run(chatId, messageId, now(), id);
}

const setClickupStmt = db.prepare(
  `UPDATE commitments SET status = 'created', clickup_task_id = ?, clickup_task_url = ?, updated_at = ? WHERE id = ?`,
);
export function setClickupTask(id: number, taskId: string, url: string | null): void {
  setClickupStmt.run(taskId, url, now(), id);
  audit('clickup_task_created', id, { taskId, url });
}

const setSnoozeStmt = db.prepare(
  `UPDATE commitments SET status = 'snoozed', snoozed_until = ?, reminder_sent_at = NULL, updated_at = ? WHERE id = ?`,
);
export function snooze(id: number, until: number): void {
  setSnoozeStmt.run(until, now(), id);
  audit('snoozed', id, { until });
}

const setDeliverableStmt = db.prepare(
  `UPDATE commitments SET deliverable = ?, updated_at = ? WHERE id = ?`,
);
export function setDeliverable(id: number, deliverable: string): void {
  setDeliverableStmt.run(deliverable, now(), id);
  audit('deliverable_edited', id, { deliverable });
}

const setReminderSentStmt = db.prepare(
  `UPDATE commitments SET reminder_sent_at = ?, updated_at = ? WHERE id = ?`,
);
export function markReminderSent(id: number): void {
  const ts = now();
  setReminderSentStmt.run(ts, ts, id);
}

const setDueStmt = db.prepare(`UPDATE commitments SET due_at = ?, updated_at = ? WHERE id = ?`);
export function setDueAt(id: number, dueAt: number | null): void {
  setDueStmt.run(dueAt, now(), id);
}

/** Commitments that are open, have a due date, and need a reminder now. */
const dueForReminderStmt = db.prepare(`
  SELECT * FROM commitments
  WHERE status = 'created'
    AND due_at IS NOT NULL
    AND due_at <= ?
    AND reminder_sent_at IS NULL
  ORDER BY due_at ASC
`);
export function commitmentsDueForReminder(thresholdMs: number): CommitmentRow[] {
  return dueForReminderStmt.all(thresholdMs) as CommitmentRow[];
}

/** Snoozed commitments whose snooze has expired — bring them back to created. */
const expiredSnoozeStmt = db.prepare(
  `SELECT * FROM commitments WHERE status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ?`,
);
export function expiredSnoozes(nowMs: number): CommitmentRow[] {
  return expiredSnoozeStmt.all(nowMs) as CommitmentRow[];
}

/** Open commitments for a given engineer, for the daily digest. */
const openByUserStmt = db.prepare(`
  SELECT * FROM commitments
  WHERE slack_user_id = ? AND status = 'created'
  ORDER BY (due_at IS NULL), due_at ASC
`);
export function openCommitmentsForUser(slackUserId: string): CommitmentRow[] {
  return openByUserStmt.all(slackUserId) as CommitmentRow[];
}

/** Distinct Slack users with at least one open commitment (digest recipients). */
const usersWithOpenStmt = db.prepare(
  `SELECT DISTINCT slack_user_id FROM commitments WHERE status = 'created'`,
);
export function usersWithOpenCommitments(): string[] {
  return (usersWithOpenStmt.all() as { slack_user_id: string }[]).map((r) => r.slack_user_id);
}

// ---- channel cursors ----

const getCursorStmt = db.prepare(`SELECT last_ts FROM channel_cursors WHERE slack_channel_id = ?`);
export function getCursor(channelId: string): string | null {
  const row = getCursorStmt.get(channelId) as { last_ts: string } | undefined;
  return row?.last_ts ?? null;
}

const upsertCursorStmt = db.prepare(`
  INSERT INTO channel_cursors (slack_channel_id, last_ts, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(slack_channel_id) DO UPDATE SET last_ts = excluded.last_ts, updated_at = excluded.updated_at
`);
export function setCursor(channelId: string, lastTs: string): void {
  upsertCursorStmt.run(channelId, lastTs, now());
}

// ---- processed messages (sweep dedup) ----

const markProcessedStmt = db.prepare(`
  INSERT OR IGNORE INTO processed_messages (slack_channel_id, slack_message_ts, processed_at)
  VALUES (?, ?, ?)
`);
export function markProcessed(channelId: string, ts: string): void {
  markProcessedStmt.run(channelId, ts, now());
}

const isProcessedStmt = db.prepare(
  `SELECT 1 FROM processed_messages WHERE slack_channel_id = ? AND slack_message_ts = ?`,
);
export function isProcessed(channelId: string, ts: string): boolean {
  return isProcessedStmt.get(channelId, ts) !== undefined;
}

// ---- user links ----

const upsertLinkStmt = db.prepare(`
  INSERT INTO user_links (slack_user_id, telegram_chat_id, display_name, created_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(slack_user_id) DO UPDATE SET telegram_chat_id = excluded.telegram_chat_id, display_name = excluded.display_name
`);
export function linkUser(
  slackUserId: string,
  telegramChatId: number,
  displayName: string | null,
): void {
  upsertLinkStmt.run(slackUserId, telegramChatId, displayName, now());
  audit('user_linked', null, { slackUserId, telegramChatId });
}

const getLinkBySlackStmt = db.prepare(`SELECT * FROM user_links WHERE slack_user_id = ?`);
export function getLinkBySlackUser(slackUserId: string): UserLinkRow | null {
  return (getLinkBySlackStmt.get(slackUserId) as UserLinkRow | undefined) ?? null;
}

const getLinkByChatStmt = db.prepare(`SELECT * FROM user_links WHERE telegram_chat_id = ?`);
export function getLinkByChat(chatId: number): UserLinkRow | null {
  return (getLinkByChatStmt.get(chatId) as UserLinkRow | undefined) ?? null;
}
