import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import cron from 'node-cron';
import { config } from './config.js';
import { logger } from './logger.js';
import { bot } from './telegram/bot.js';
import { slackApp } from './slack/webhook.js';
import { clickupApp } from './clickup/webhook.js';
import { runSweep } from './pipeline.js';
import { runReminders } from './jobs/reminders.js';
import { runDigest } from './jobs/digest.js';

const app = new Hono();
app.get('/', (c) => c.text('promise-keeper ok'));
app.route('/slack', slackApp); // exposes POST /slack/events
app.route('/clickup', clickupApp); // exposes POST /clickup/webhook

if (!config.CLICKUP_WEBHOOK_SECRET) {
  logger.warn('CLICKUP_WEBHOOK_SECRET is unset — ClickUp webhook signatures are not verified');
}

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info(
    { port: info.port, slackEvents: `${config.PUBLIC_URL}/slack/events` },
    'webhook server listening',
  );
});

// Schedule background jobs in the configured timezone.
const cronOpts = { timezone: config.TZ };
const safe = (name: string, fn: () => Promise<void>) => () => {
  fn().catch((err) => logger.error({ err: String(err), job: name }, 'scheduled job failed'));
};

cron.schedule(config.SWEEP_CRON, safe('sweep', runSweep), cronOpts);
cron.schedule(config.REMINDER_CRON, safe('reminders', runReminders), cronOpts);
cron.schedule(config.DIGEST_CRON, safe('digest', runDigest), cronOpts);
logger.info(
  { sweep: config.SWEEP_CRON, reminders: config.REMINDER_CRON, digest: config.DIGEST_CRON },
  'cron jobs scheduled',
);

// Register the slash-command menu so Telegram shows autocomplete.
bot.api
  .setMyCommands([
    { command: 'demo', description: 'See the whole flow with a sample promise' },
    { command: 'link', description: 'Link your Slack user id to this chat' },
    { command: 'list', description: 'Your open commitments' },
    { command: 'help', description: 'Show help' },
  ])
  .catch((err) => logger.warn({ err: String(err) }, 'setMyCommands failed'));

// Start the Telegram bot (long polling).
bot
  .start({
    onStart: (me) => logger.info({ username: me.username }, 'telegram bot started'),
  })
  .catch((err) => logger.error({ err: String(err) }, 'telegram bot failed to start'));

// Graceful shutdown.
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  await bot.stop().catch(() => undefined);
  server.close();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
