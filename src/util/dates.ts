/** Today's date as YYYY-MM-DD in the server's configured timezone. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Convert an extracted due date (YYYY-MM-DD) to an epoch-ms timestamp.
 * We anchor to 17:00 local time — a reasonable "end of business day" so
 * reminders fire during working hours rather than at midnight.
 */
export function dueDateToEpoch(dueDate: string | null | undefined): number | null {
  if (!dueDate) return null;
  const m = dueDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    const parsed = Date.parse(dueDate);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const ms = Date.parse(`${dueDate}T17:00:00`);
  return Number.isNaN(ms) ? null : ms;
}

/** Human-friendly due-date label for Telegram cards. */
export function formatDue(epochMs: number | null): string {
  if (epochMs == null) return 'no due date';
  const d = new Date(epochMs);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
