import { config } from '../config.js';
import { logger } from '../logger.js';
import type { Priority } from '../types.js';

const BASE = 'https://api.clickup.com/api/v2';

/** ClickUp priority ids: 1=urgent … 4=low. */
const PRIORITY_ID: Record<Priority, number> = {
  urgent: 1,
  high: 2,
  normal: 3,
  low: 4,
};

interface ClickUpTask {
  id: string;
  url: string;
  status?: { status: string };
}

async function clickup<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: config.CLICKUP_TOKEN,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ClickUp ${init.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export interface CreatedTask {
  taskId: string;
  url: string | null;
  status: string;
}

/** Create a task in the configured list. */
export async function createTask(input: {
  listId: string;
  name: string;
  description: string;
  dueAtMs: number | null;
  priority: Priority;
}): Promise<CreatedTask> {
  const body: Record<string, unknown> = {
    name: input.name,
    description: input.description,
    priority: PRIORITY_ID[input.priority],
  };
  if (input.dueAtMs != null) body.due_date = input.dueAtMs;

  const task = await clickup<ClickUpTask>(`/list/${input.listId}/task`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  logger.info({ taskId: task.id }, 'clickup task created');
  return { taskId: task.id, url: task.url ?? null, status: task.status?.status ?? 'open' };
}

/**
 * Resolve the terminal status for the task's list.
 *
 * ClickUp status `type`s are open | custom | done | closed, ordered left→right
 * by `orderindex`. A list can have several done/closed statuses with workflow-
 * specific names ("Cannot Reproduce", "Not a Bug", "Closed"). The canonical
 * "finished" state is the **right-most** done/closed status — the highest
 * orderindex — so we pick that rather than guessing by name.
 */
async function findClosedStatus(taskId: string): Promise<string | null> {
  const task = await clickup<{ list?: { id?: string } }>(`/task/${taskId}`, { method: 'GET' });
  const listId = task.list?.id;
  if (!listId) return null;
  const list = await clickup<{ statuses?: { status: string; type: string; orderindex: number }[] }>(
    `/list/${listId}`,
    { method: 'GET' },
  );
  const terminal = (list.statuses ?? [])
    .filter((s) => s.type === 'closed' || s.type === 'done')
    .sort((a, b) => Number(a.orderindex) - Number(b.orderindex))
    .at(-1);
  return terminal?.status ?? null;
}

/**
 * Close a task by moving it to its list's closed/done status.
 * Falls back to "complete" if the list's statuses can't be read.
 */
export async function closeTask(taskId: string): Promise<CreatedTask> {
  let status: string | null = null;
  try {
    status = await findClosedStatus(taskId);
  } catch (err) {
    logger.warn({ err: String(err), taskId }, 'could not read list statuses; using fallback');
  }
  const target = status ?? 'complete';
  const task = await clickup<ClickUpTask>(`/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ status: target }),
  });
  logger.info({ taskId, status: target }, 'clickup task closed');
  return { taskId: task.id, url: task.url ?? null, status: task.status?.status ?? target };
}
