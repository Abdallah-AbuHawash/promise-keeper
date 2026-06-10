import { config } from './config.js';
import { logger } from './logger.js';
import {
  createCommitment,
  getCursor,
  getLinkBySlackUser,
  isProcessed,
  markProcessed,
  setCursor,
} from './db/index.js';
import { extractFromPin, extractFromSweep } from './anthropic/agent.js';
import {
  getHistorySince,
  getMessage,
  getPermalink,
  getThread,
  type SlackMessage,
} from './slack/client.js';
import { dueDateToEpoch } from './util/dates.js';
import { sendApprovalCard } from './telegram/bot.js';
import type { ExtractionResultParsed } from './anthropic/schema.js';
import type { Source } from './types.js';

interface IngestOpts {
  source: Source;
  channelId: string;
  extraction: ExtractionResultParsed;
  /** Pin lane: the exact flagged message ts (applies to all commitments). */
  pinnedTs?: string;
  /** Pin lane: route to the reactor regardless of detected author. */
  ownerOverride?: string;
}

/**
 * Shared sink for both lanes: persist extracted commitments and surface an
 * approval card to the owning engineer's Telegram. Dedup + confidence gating
 * live here so both lanes behave identically.
 */
async function ingest(opts: IngestOpts): Promise<void> {
  const { source, channelId, extraction } = opts;

  for (const c of extraction.commitments) {
    const messageTs = opts.pinnedTs ?? c.messageTs ?? null;
    if (!messageTs) {
      logger.warn({ deliverable: c.deliverable }, 'skipping commitment with no source ts');
      continue;
    }

    // Sweep dedup: never re-evaluate a message we've already swept.
    if (source === 'sweep' && isProcessed(channelId, messageTs)) continue;
    markProcessed(channelId, messageTs);

    // Confidence gate (sweep is lower-trust than an explicit pin).
    if (source === 'sweep' && c.confidence < config.SWEEP_MIN_CONFIDENCE) {
      logger.debug(
        { deliverable: c.deliverable, confidence: c.confidence },
        'sweep commitment below confidence threshold',
      );
      continue;
    }

    const ownerSlackId = opts.ownerOverride ?? c.authorUserId ?? null;
    const permalink = await getPermalink(channelId, messageTs);

    const row = createCommitment({
      source,
      slackChannelId: channelId,
      slackMessageTs: messageTs,
      slackThreadTs: null,
      slackUserId: ownerSlackId ?? 'unknown',
      slackPermalink: permalink,
      extracted: c,
      dueAt: dueDateToEpoch(c.dueDate),
    });

    if (!row) continue; // duplicate Slack message → already tracked

    const link = ownerSlackId ? getLinkBySlackUser(ownerSlackId) : null;
    if (!link) {
      logger.warn(
        { commitmentId: row.id, ownerSlackId },
        'no Telegram link for owner — card not delivered; run /link',
      );
      continue;
    }

    await sendApprovalCard(row, link.telegram_chat_id);
  }
}

/** Pin lane entrypoint: an engineer reacted with the trigger emoji. */
export async function handlePin(
  channelId: string,
  messageTs: string,
  reactorUserId: string,
): Promise<void> {
  const message = await getMessage(channelId, messageTs);
  if (!message) {
    logger.warn({ channelId, messageTs }, 'pinned message not found');
    return;
  }

  // Flagged message first, then thread context (deduped).
  const threadRoot = message.threadTs ?? messageTs;
  const thread = await getThread(channelId, threadRoot).catch(() => [] as SlackMessage[]);
  const context = [message, ...thread.filter((m) => m.ts !== message.ts)];

  const extraction = await extractFromPin(context);
  if (extraction.commitments.length === 0) {
    logger.info({ channelId, messageTs }, 'pin produced no commitments');
    return;
  }
  await ingest({
    source: 'pin',
    channelId,
    extraction,
    pinnedTs: messageTs,
    ownerOverride: reactorUserId,
  });
}

/** Sweep lane: scan one channel since its cursor and advance the cursor. */
export async function runSweepForChannel(channelId: string): Promise<void> {
  const since = getCursor(channelId);
  const history = await getHistorySince(channelId, since);
  if (history.length === 0) {
    logger.debug({ channelId }, 'sweep: no new messages');
    return;
  }

  const extraction = await extractFromSweep(history);
  await ingest({ source: 'sweep', channelId, extraction });

  // Advance cursor to the newest message we actually fetched (oldest-first list).
  const newest = history[history.length - 1]!.ts;
  setCursor(channelId, newest);
  logger.info({ channelId, scanned: history.length, cursor: newest }, 'sweep complete');
}

/** Sweep all watched channels (called by cron and the manual sweep script). */
export async function runSweep(): Promise<void> {
  for (const channelId of config.SLACK_WATCH_CHANNELS) {
    try {
      await runSweepForChannel(channelId);
    } catch (err) {
      logger.error({ channelId, err: String(err) }, 'sweep failed for channel');
    }
  }
}
