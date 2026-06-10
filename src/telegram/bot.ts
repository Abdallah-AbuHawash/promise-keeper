import { Bot, type Context } from 'grammy';
import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  createCommitment,
  getCommitment,
  getLinkByChat,
  linkUser,
  openCommitmentsForUser,
  setClickupTask,
  setDeliverable,
  setDueAt,
  setStatus,
  setTelegramCard,
  snooze as snoozeDb,
} from '../db/index.js';
import { createTask, closeTask } from '../clickup/client.js';
import { extractFromPin } from '../anthropic/agent.js';
import { dueDateToEpoch } from '../util/dates.js';
import {
  approvalKeyboard,
  approvalText,
  createdText,
  digestText,
  dismissedText,
  doneText,
  reminderKeyboard,
  reminderText,
  snoozedText,
} from './cards.js';
import type { CommitmentRow } from '../types.js';

export const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

/** chatId → commitmentId awaiting an edited title from the user. */
const pendingEdits = new Map<number, number>();

function taskDescription(row: CommitmentRow): string {
  const parts = [
    row.customer ? `Customer: ${row.customer}` : null,
    row.quote ? `Promise: "${row.quote}"` : null,
    row.slack_permalink ? `Slack: ${row.slack_permalink}` : null,
    `Captured by Promise-Keeper (${row.source}).`,
  ].filter(Boolean);
  return parts.join('\n');
}

/** Deliver an approval card to an engineer's Telegram chat. */
export async function sendApprovalCard(row: CommitmentRow, chatId: number): Promise<void> {
  const msg = await bot.api.sendMessage(chatId, approvalText(row), {
    ...HTML,
    reply_markup: approvalKeyboard(row.id),
  });
  setTelegramCard(row.id, chatId, msg.message_id);
  logger.info({ commitmentId: row.id, chatId }, 'approval card sent');
}

/** Deliver a due-date reminder with Done/Snooze actions. */
export async function sendReminder(row: CommitmentRow, chatId: number): Promise<void> {
  await bot.api.sendMessage(chatId, reminderText(row), {
    ...HTML,
    reply_markup: reminderKeyboard(row.id),
  });
}

// ---- commands ----

bot.command('start', async (ctx) => {
  const payload = ctx.match?.trim();
  if (payload) {
    linkUser(payload, ctx.chat.id, ctx.from?.first_name ?? null);
    await ctx.reply(
      `✅ Linked this chat to Slack user <code>${payload}</code>. Promises you make will arrive here.`,
      HTML,
    );
    return;
  }
  await ctx.reply(
    [
      '👋 <b>Promise-Keeper</b> — I turn the promises you make to customers on Slack into tracked ClickUp tasks.',
      '',
      'To start, link your Slack user id:',
      '<code>/link U0123ABC</code>',
      '',
      'Find your id in Slack: Profile → ⋯ → Copy member ID.',
    ].join('\n'),
    HTML,
  );
});

bot.command('link', async (ctx) => {
  const slackUserId = ctx.match?.trim();
  if (!slackUserId) {
    await ctx.reply('Usage: <code>/link U0123ABC</code>', HTML);
    return;
  }
  linkUser(slackUserId, ctx.chat.id, ctx.from?.first_name ?? null);
  await ctx.reply(`✅ Linked to Slack user <code>${slackUserId}</code>.`, HTML);
});

bot.command('list', async (ctx) => {
  const link = getLinkByChat(ctx.chat.id);
  if (!link) {
    await ctx.reply('You are not linked yet. Use <code>/link U0123ABC</code>.', HTML);
    return;
  }
  const rows = openCommitmentsForUser(link.slack_user_id);
  await ctx.reply(digestText(rows), HTML);
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    [
      '<b>Promise-Keeper commands</b>',
      '/demo — see the whole flow with a sample promise (no Slack setup needed)',
      '/link &lt;slack-user-id&gt; — connect your Slack identity to this chat',
      '/list — your open commitments',
      '/help — this message',
      '',
      'When you promise a customer something on Slack, react with 📌 (or wait for the sweep). I’ll send a card here to confirm before creating a ClickUp task.',
    ].join('\n'),
    HTML,
  );
});

/** Sample promises the /demo command rotates through. */
const DEMO_PROMISES = [
  "Thanks for the call — I'll send over the integration report by next Monday and loop in our solutions team.",
  "Got it. I'll get that billing bug fixed by Friday and follow up with you once it's deployed.",
  'Sure, let me check with engineering and get back to you tomorrow with a timeline for the SSO feature.',
  "Will do — I'll share the revised pricing proposal by end of week and schedule a follow-up call.",
];

/**
 * Self-contained showcase: run a sample promise through the real extraction
 * pipeline and deliver an approval card here — no Slack or linking required.
 */
bot.command('demo', async (ctx) => {
  await ctx.replyWithChatAction('typing');
  const text = DEMO_PROMISES[Math.floor(Math.random() * DEMO_PROMISES.length)]!;
  const ts = `demo-${Date.now()}`;
  await ctx.reply(`🧪 <b>Demo</b> — pretend this just landed in Slack:\n\n💬 <i>${text}</i>`, HTML);

  try {
    const extraction = await extractFromPin([{ ts, user: 'U_DEMO', text, threadTs: null }]);
    const c = extraction.commitments[0];
    if (!c) {
      await ctx.reply('Hm, no commitment detected in the sample. Try /demo again.');
      return;
    }
    const row = createCommitment({
      source: 'pin',
      slackChannelId: 'DEMO',
      slackMessageTs: ts,
      slackThreadTs: null,
      slackUserId: 'U_DEMO',
      slackPermalink: null,
      extracted: c,
      dueAt: dueDateToEpoch(c.dueDate),
    });
    if (!row) {
      await ctx.reply('Could not create the demo commitment. Try again.');
      return;
    }
    await sendApprovalCard(row, ctx.chat.id);
  } catch (err) {
    logger.error({ err: String(err) }, 'demo failed');
    await ctx.reply(
      '⚠️ Demo failed — check the server logs (likely an Anthropic or ClickUp credential issue).',
    );
  }
});

// ---- inline button actions ----

function parseAction(data: string): { action: string; id: number } | null {
  const [action, idStr] = data.split(':');
  const id = Number(idStr);
  if (!action || !Number.isInteger(id)) return null;
  return { action, id };
}

bot.on('callback_query:data', async (ctx) => {
  const parsed = parseAction(ctx.callbackQuery.data);
  if (!parsed) {
    await ctx.answerCallbackQuery();
    return;
  }
  const { action, id } = parsed;
  const row = getCommitment(id);
  if (!row) {
    await ctx.answerCallbackQuery({ text: 'This commitment no longer exists.' });
    return;
  }

  try {
    switch (action) {
      case 'create':
        await handleCreate(ctx, row);
        break;
      case 'dismiss':
        setStatus(id, 'dismissed');
        await ctx.editMessageText(dismissedText(row), HTML);
        await ctx.answerCallbackQuery({ text: 'Dismissed.' });
        break;
      case 'snooze':
        await handleSnooze(ctx, row);
        break;
      case 'edit':
        pendingEdits.set(ctx.chat?.id ?? row.telegram_chat_id ?? 0, id);
        await ctx.answerCallbackQuery();
        await ctx.reply(
          'Reply with the corrected title. Optionally append a due date:\n<code>Send Q3 report | 2026-06-20</code>',
          HTML,
        );
        break;
      case 'done':
        await handleDone(ctx, row);
        break;
      default:
        await ctx.answerCallbackQuery();
    }
  } catch (err) {
    logger.error({ err: String(err), action, id }, 'callback action failed');
    await ctx.answerCallbackQuery({
      text: 'Something went wrong — the action was not completed. Try again.',
      show_alert: true,
    });
  }
});

async function handleCreate(ctx: Context, row: CommitmentRow) {
  if (row.status !== 'pending_approval' && row.status !== 'snoozed') {
    await ctx.answerCallbackQuery({ text: 'Already handled.' });
    return;
  }
  await ctx.answerCallbackQuery({ text: 'Creating ClickUp task…' });
  const result = await createTask({
    listId: config.CLICKUP_LIST_ID,
    name: row.deliverable,
    description: taskDescription(row),
    dueAtMs: row.due_at,
    priority: row.priority,
  });
  setClickupTask(row.id, result.taskId, result.url);
  const updated = getCommitment(row.id);
  if (updated) await ctx.editMessageText(createdText(updated), HTML);
}

async function handleSnooze(ctx: Context, row: CommitmentRow) {
  const until = Date.now() + ONE_DAY_MS;
  snoozeDb(row.id, until);
  await ctx.editMessageText(snoozedText(row, until), HTML);
  await ctx.answerCallbackQuery({ text: 'Snoozed for a day.' });
}

async function handleDone(ctx: Context, row: CommitmentRow) {
  if (!row.clickup_task_id) {
    setStatus(row.id, 'done');
    await ctx.editMessageText(doneText(row), HTML);
    await ctx.answerCallbackQuery({ text: 'Marked done.' });
    return;
  }
  await ctx.answerCallbackQuery({ text: 'Closing ClickUp task…' });
  await closeTask(row.clickup_task_id);
  setStatus(row.id, 'done');
  await ctx.editMessageText(doneText(row), HTML);
}

// ---- edit follow-up (plain text reply after tapping Edit) ----

bot.on('message:text', async (ctx) => {
  const chatId = ctx.chat.id;
  const id = pendingEdits.get(chatId);
  if (id === undefined) return; // not in an edit flow; ignore
  pendingEdits.delete(chatId);

  const row = getCommitment(id);
  if (!row) {
    await ctx.reply('That commitment no longer exists.');
    return;
  }

  const [titlePart, datePart] = ctx.message.text.split('|').map((s) => s.trim());
  if (titlePart) setDeliverable(id, titlePart);
  if (datePart) setDueAt(id, dueDateToEpoch(datePart));

  const updated = getCommitment(id);
  if (updated && updated.telegram_chat_id && updated.telegram_message_id) {
    await bot.api.editMessageText(
      updated.telegram_chat_id,
      updated.telegram_message_id,
      approvalText(updated),
      { ...HTML, reply_markup: approvalKeyboard(updated.id) },
    );
    await ctx.reply('✏️ Updated.');
  }
});
