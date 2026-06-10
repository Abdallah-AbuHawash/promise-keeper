import 'dotenv/config';
import { z } from 'zod';

/**
 * Centralized, validated configuration.
 *
 * Every environment variable the app depends on is declared here so a missing
 * or malformed value fails loudly at boot instead of surfacing as a confusing
 * runtime error deep in a request handler.
 */
const schema = z.object({
  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-8'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),

  // Slack (Events API webhook)
  SLACK_SIGNING_SECRET: z.string().min(1, 'SLACK_SIGNING_SECRET is required'),
  SLACK_BOT_TOKEN: z.string().min(1, 'SLACK_BOT_TOKEN is required'),
  SLACK_WATCH_CHANNELS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  SLACK_TRIGGER_EMOJI: z.string().default('pushpin'),

  // ClickUp REST API (personal token, pk_...)
  CLICKUP_TOKEN: z.string().min(1, 'CLICKUP_TOKEN is required'),
  CLICKUP_LIST_ID: z.string().min(1, 'CLICKUP_LIST_ID is required'),
  // Secret returned when the ClickUp webhook is created; verifies inbound events.
  CLICKUP_WEBHOOK_SECRET: z.string().default(''),
  // When a ClickUp task is closed, also post a confirmation in the Slack thread.
  SLACK_POST_ON_CLOSE: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),

  // Runtime
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  DATABASE_PATH: z.string().default('./data/promise-keeper.db'),
  SWEEP_CRON: z.string().default('*/5 * * * *'),
  REMINDER_CRON: z.string().default('*/15 * * * *'),
  DIGEST_CRON: z.string().default('0 8 * * *'),
  TZ: z.string().default('UTC'),
  SWEEP_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(`\nInvalid environment configuration:\n${issues}\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const config = load();
