import { logger } from '../logger.js';
import {
  getLinkBySlackUser,
  openCommitmentsForUser,
  usersWithOpenCommitments,
} from '../db/index.js';
import { bot } from '../telegram/bot.js';
import { digestText } from '../telegram/cards.js';

/** Daily digest: one message per engineer summarizing their open commitments. */
export async function runDigest(): Promise<void> {
  for (const slackUserId of usersWithOpenCommitments()) {
    const link = getLinkBySlackUser(slackUserId);
    if (!link) continue;
    const rows = openCommitmentsForUser(slackUserId);
    if (rows.length === 0) continue;
    try {
      await bot.api.sendMessage(link.telegram_chat_id, digestText(rows), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
      logger.info({ slackUserId, count: rows.length }, 'digest sent');
    } catch (err) {
      logger.error({ err: String(err), slackUserId }, 'digest failed');
    }
  }
}
