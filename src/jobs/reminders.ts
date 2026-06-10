import { logger } from '../logger.js';
import {
  commitmentsDueForReminder,
  expiredSnoozes,
  getCommitment,
  getLinkBySlackUser,
  markReminderSent,
  setStatus,
} from '../db/index.js';
import { sendApprovalCard, sendReminder } from '../telegram/bot.js';

/** Fire reminders up to this long before the due time. */
const REMINDER_LEAD_MS = 60 * 60 * 1000; // 1 hour

/**
 * Periodic job:
 *  1. Revive snoozed commitments whose snooze has expired.
 *  2. Send a reminder for any open, due (or nearly-due) commitment.
 */
export async function runReminders(): Promise<void> {
  const now = Date.now();

  // 1. Expired snoozes come back.
  for (const row of expiredSnoozes(now)) {
    if (row.clickup_task_id) {
      // Already a task → back to created; the reminder check below re-fires.
      setStatus(row.id, 'created');
    } else {
      // Never approved → re-surface the approval card.
      setStatus(row.id, 'pending_approval');
      const link = getLinkBySlackUser(row.slack_user_id);
      const fresh = getCommitment(row.id);
      if (link && fresh) {
        await sendApprovalCard(fresh, link.telegram_chat_id).catch((err) =>
          logger.error({ err: String(err), id: row.id }, 'resend approval card failed'),
        );
      }
    }
  }

  // 2. Due reminders.
  const due = commitmentsDueForReminder(now + REMINDER_LEAD_MS);
  for (const row of due) {
    const link = getLinkBySlackUser(row.slack_user_id);
    if (!link) {
      logger.warn({ id: row.id }, 'due commitment has no linked chat; skipping reminder');
      continue;
    }
    try {
      await sendReminder(row, link.telegram_chat_id);
      markReminderSent(row.id);
      logger.info({ id: row.id }, 'reminder sent');
    } catch (err) {
      logger.error({ err: String(err), id: row.id }, 'reminder failed');
    }
  }
}
