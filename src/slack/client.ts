import { config } from '../config.js';
import { logger } from '../logger.js';

/** A normalized Slack message we care about. */
export interface SlackMessage {
  ts: string;
  user: string | null;
  text: string;
  threadTs: string | null;
}

interface RawSlackMessage {
  ts: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  thread_ts?: string;
}

/** Call a Slack Web API method (GET). Throws on `ok:false`. */
async function slackCall(
  method: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = `https://slack.com/api/${method}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.SLACK_BOT_TOKEN}` },
  });
  const body = (await res.json()) as { ok: boolean; error?: string; [k: string]: unknown };
  if (!body.ok) throw new Error(`slack ${method} failed: ${body.error}`);
  return body;
}

function normalize(m: RawSlackMessage): SlackMessage {
  return {
    ts: m.ts,
    user: m.user ?? null,
    text: m.text ?? '',
    threadTs: m.thread_ts ?? null,
  };
}

/** Skip channel-noise: joins/leaves, bot posts, and our own messages. */
function isHumanMessage(m: RawSlackMessage): boolean {
  return !m.subtype && !m.bot_id && !!m.user && !!m.text;
}

// ---- reads used by the pipeline ----

/** Fetch a single message by ts (used by the pin lane). */
export async function getMessage(channel: string, ts: string): Promise<SlackMessage | null> {
  const body = (await slackCall('conversations.history', {
    channel,
    latest: ts,
    oldest: ts,
    inclusive: 'true',
    limit: '1',
  })) as { messages?: RawSlackMessage[] };
  const m = body.messages?.[0];
  return m ? normalize(m) : null;
}

/** Fetch a thread (the parent message + replies). Empty if not a thread root. */
export async function getThread(channel: string, threadTs: string): Promise<SlackMessage[]> {
  const body = (await slackCall('conversations.replies', {
    channel,
    ts: threadTs,
    limit: '50',
  })) as { messages?: RawSlackMessage[] };
  return (body.messages ?? []).map(normalize);
}

/**
 * Channel history newer than `sinceTs` (exclusive), oldest-first.
 * Returns only human messages. Used by the sweep lane.
 */
export async function getHistorySince(
  channel: string,
  sinceTs: string | null,
  limit = 50,
): Promise<SlackMessage[]> {
  const params: Record<string, string> = { channel, limit: String(limit) };
  if (sinceTs) params.oldest = sinceTs; // oldest is inclusive; we drop the boundary below
  const body = (await slackCall('conversations.history', params)) as {
    messages?: RawSlackMessage[];
  };
  const msgs = (body.messages ?? [])
    .filter(isHumanMessage)
    .filter((m) => !sinceTs || m.ts !== sinceTs) // drop the inclusive boundary
    .map(normalize);
  // Slack returns newest-first; return oldest-first for natural reading order.
  return msgs.reverse();
}

// ---- best-effort enrichers for nicer cards ----

export async function getPermalink(channel: string, messageTs: string): Promise<string | null> {
  try {
    const body = (await slackCall('chat.getPermalink', { channel, message_ts: messageTs })) as {
      permalink?: string;
    };
    return body.permalink ?? null;
  } catch (err) {
    logger.warn({ err: String(err) }, 'getPermalink failed');
    return null;
  }
}

/** Post a message (optionally as a thread reply). Requires `chat:write`. Best-effort. */
export async function postMessage(
  channel: string,
  text: string,
  threadTs?: string | null,
): Promise<boolean> {
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) }),
    });
    const body = (await res.json()) as { ok: boolean; error?: string };
    if (!body.ok) {
      logger.warn({ error: body.error }, 'chat.postMessage failed');
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err: String(err) }, 'chat.postMessage threw');
    return false;
  }
}

export async function getDisplayName(userId: string): Promise<string | null> {
  try {
    const body = (await slackCall('users.info', { user: userId })) as {
      user?: { real_name?: string; name?: string };
    };
    return body.user?.real_name ?? body.user?.name ?? null;
  } catch (err) {
    logger.warn({ err: String(err) }, 'users.info failed');
    return null;
  }
}
