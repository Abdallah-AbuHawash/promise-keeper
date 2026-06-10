import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getCommitmentByClickupTask, getLinkBySlackUser, markDoneIfOpen } from '../db/index.js';
import { postMessage } from '../slack/client.js';
import { bot } from '../telegram/bot.js';
import { escapeHtml } from '../telegram/cards.js';

interface ClickUpEvent {
  event?: string;
  task_id?: string;
  history_items?: {
    field?: string;
    after?: { status?: string; type?: string } | null;
  }[];
}

/** Verify ClickUp's `X-Signature` (hex HMAC-SHA256 of the raw body). */
function verify(rawBody: string, signature: string | undefined): boolean {
  if (!config.CLICKUP_WEBHOOK_SECRET) return true; // unset → accept (dev), warned at startup
  if (!signature) return false;
  const expected = createHmac('sha256', config.CLICKUP_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const clickupApp = new Hono();

clickupApp.post('/webhook', async (c) => {
  const rawBody = await c.req.text();
  if (!verify(rawBody, c.req.header('x-signature'))) {
    logger.warn('rejected ClickUp webhook with invalid signature');
    return c.text('invalid signature', 401);
  }

  let body: ClickUpEvent;
  try {
    body = JSON.parse(rawBody) as ClickUpEvent;
  } catch {
    return c.text('bad request', 400);
  }

  const taskId = body.task_id;
  const statusItem = body.history_items?.find((h) => h.field === 'status');
  const type = statusItem?.after?.type;
  const isClosed = type === 'closed' || type === 'done';

  // Only react to a task moving into a terminal status.
  if (!taskId || !isClosed) return c.text('ok');

  // Transition exactly once; ignores the echo from our own Telegram-driven close.
  if (!markDoneIfOpen(taskId)) return c.text('ok');

  const row = getCommitmentByClickupTask(taskId);
  if (!row) return c.text('ok');

  // Notify the engineer on Telegram.
  const link = getLinkBySlackUser(row.slack_user_id);
  if (link) {
    await bot.api
      .sendMessage(
        link.telegram_chat_id,
        `✅ <b>Closed in ClickUp</b>\n${escapeHtml(row.deliverable)}`,
        { parse_mode: 'HTML' },
      )
      .catch((err) => logger.warn({ err: String(err) }, 'telegram close-notify failed'));
  }

  // Optionally confirm in the original Slack thread (closes the loop with the customer).
  const isDemo = row.slack_channel_id === 'DEMO' || row.slack_message_ts.startsWith('demo-');
  if (config.SLACK_POST_ON_CLOSE && !isDemo) {
    await postMessage(
      row.slack_channel_id,
      `✅ Resolved: ${row.deliverable}`,
      row.slack_thread_ts ?? row.slack_message_ts,
    );
  }

  logger.info({ taskId, commitmentId: row.id }, 'reverse-sync: commitment closed from ClickUp');
  return c.text('ok');
});
