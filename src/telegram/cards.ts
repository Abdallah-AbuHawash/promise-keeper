import { InlineKeyboard } from 'grammy';
import type { CommitmentRow } from '../types.js';
import { formatDue } from '../util/dates.js';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PRIORITY_EMOJI: Record<string, string> = {
  low: '⚪',
  normal: '🔵',
  high: '🟠',
  urgent: '🔴',
};

function sourceLabel(row: CommitmentRow): string {
  return row.source === 'pin' ? '📌 pinned' : '🧹 swept';
}

/** The approval card shown when a new commitment is detected. */
export function approvalText(row: CommitmentRow): string {
  const conf = Math.round(row.confidence * 100);
  const lines = [
    '🤝 <b>Commitment detected</b>',
    '',
    `<b>${escapeHtml(row.deliverable)}</b>`,
    `👤 Customer: ${row.customer ? escapeHtml(row.customer) : '—'}`,
    `📅 Due: ${escapeHtml(formatDue(row.due_at))}`,
    `${PRIORITY_EMOJI[row.priority] ?? '🔵'} Priority: ${row.priority}`,
    `🎯 Confidence: ${conf}%  ·  ${sourceLabel(row)}`,
  ];
  if (row.quote) lines.push('', `💬 <i>${escapeHtml(row.quote)}</i>`);
  if (row.reasoning) lines.push('', `🧠 ${escapeHtml(row.reasoning)}`);
  if (row.confidence < 0.6) {
    lines.push('', '⚠️ <i>Low confidence — double-check this is a real commitment.</i>');
  }
  if (row.slack_permalink) lines.push('', `🔗 <a href="${row.slack_permalink}">View in Slack</a>`);
  return lines.join('\n');
}

export function approvalKeyboard(id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Create task', `create:${id}`)
    .text('✏️ Edit', `edit:${id}`)
    .row()
    .text('💤 Snooze 1d', `snooze:${id}`)
    .text('🗑 Dismiss', `dismiss:${id}`);
}

/** Card state after a ClickUp task is created. */
export function createdText(row: CommitmentRow): string {
  const link = row.clickup_task_url
    ? `<a href="${row.clickup_task_url}">${escapeHtml(row.clickup_task_id ?? 'task')}</a>`
    : escapeHtml(row.clickup_task_id ?? 'task');
  return [
    '✅ <b>Task created in ClickUp</b>',
    '',
    `<b>${escapeHtml(row.deliverable)}</b>`,
    `📅 Due: ${escapeHtml(formatDue(row.due_at))}`,
    `🎫 ${link}`,
  ].join('\n');
}

export function dismissedText(row: CommitmentRow): string {
  return `🗑 <s>${escapeHtml(row.deliverable)}</s>\nDismissed — not tracked.`;
}

export function snoozedText(row: CommitmentRow, until: number): string {
  return `💤 <b>${escapeHtml(row.deliverable)}</b>\nSnoozed until ${escapeHtml(formatDue(until))}.`;
}

/** Reminder DM fired before/at the due date. */
export function reminderText(row: CommitmentRow): string {
  const link = row.clickup_task_url ? `\n🎫 <a href="${row.clickup_task_url}">Open task</a>` : '';
  return [
    '⏰ <b>Reminder — commitment due</b>',
    '',
    `<b>${escapeHtml(row.deliverable)}</b>`,
    `👤 ${row.customer ? escapeHtml(row.customer) : '—'}`,
    `📅 Due: ${escapeHtml(formatDue(row.due_at))}` + link,
  ].join('\n');
}

export function reminderKeyboard(id: number): InlineKeyboard {
  return new InlineKeyboard().text('✔️ Done', `done:${id}`).text('💤 Snooze 1d', `snooze:${id}`);
}

export function doneText(row: CommitmentRow): string {
  return `✔️ <b>${escapeHtml(row.deliverable)}</b>\nMarked done — ClickUp task closed.`;
}

/** Daily digest body for one engineer. */
export function digestText(rows: CommitmentRow[]): string {
  const now = Date.now();
  const lines = ['📋 <b>Your open commitments</b>', ''];
  for (const r of rows) {
    const overdue = r.due_at != null && r.due_at < now ? ' ⚠️ <b>OVERDUE</b>' : '';
    lines.push(
      `• <b>${escapeHtml(r.deliverable)}</b> — ${escapeHtml(formatDue(r.due_at))}${overdue}`,
    );
  }
  if (rows.length === 0) lines.push('Nothing open. 🎉');
  return lines.join('\n');
}
