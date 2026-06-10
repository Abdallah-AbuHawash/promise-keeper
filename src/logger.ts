import { pino } from 'pino';
import { config } from './config.js';

/**
 * Structured logger. Pretty-prints in a TTY for local dev, emits JSON otherwise
 * so logs are machine-parseable in production.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  transport: process.stdout.isTTY
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
});

export type Logger = typeof logger;
