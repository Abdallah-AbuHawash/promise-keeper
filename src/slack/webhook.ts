import { Hono } from 'hono';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { verifySlackSignature } from './verify.js';
import { handlePin } from '../pipeline.js';

interface SlackEnvelope {
  type: string;
  challenge?: string;
  event?: {
    type: string;
    user?: string;
    reaction?: string;
    item?: { type: string; channel: string; ts: string };
  };
}

export const slackApp = new Hono();

slackApp.post('/events', async (c) => {
  const rawBody = await c.req.text();

  const ok = verifySlackSignature({
    signingSecret: config.SLACK_SIGNING_SECRET,
    signature: c.req.header('x-slack-signature'),
    timestamp: c.req.header('x-slack-request-timestamp'),
    rawBody,
  });
  if (!ok) {
    logger.warn('rejected Slack request with invalid signature');
    return c.text('invalid signature', 401);
  }

  let body: SlackEnvelope;
  try {
    body = JSON.parse(rawBody) as SlackEnvelope;
  } catch {
    return c.text('bad request', 400);
  }

  // Slack endpoint verification handshake.
  if (body.type === 'url_verification' && body.challenge) {
    return c.json({ challenge: body.challenge });
  }

  if (body.type === 'event_callback' && body.event?.type === 'reaction_added') {
    const ev = body.event;
    const matchesEmoji = ev.reaction === config.SLACK_TRIGGER_EMOJI;
    const watched = ev.item && config.SLACK_WATCH_CHANNELS.includes(ev.item.channel);
    if (matchesEmoji && ev.item?.type === 'message' && watched && ev.user) {
      const { channel, ts } = ev.item;
      const reactor = ev.user;
      // Ack within Slack's 3s window; process out of band.
      void handlePin(channel, ts, reactor).catch((err) =>
        logger.error({ err: String(err), channel, ts }, 'handlePin failed'),
      );
    }
  }

  // Always 200 quickly so Slack doesn't retry.
  return c.text('ok');
});
