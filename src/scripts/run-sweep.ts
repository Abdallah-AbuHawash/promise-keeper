/**
 * Manual sweep — run the Slack scan + extraction once and exit.
 * Useful for demos and debugging without waiting for the cron.
 *   npm run sweep
 */
import { runSweep } from '../pipeline.js';
import { logger } from '../logger.js';

await runSweep();
logger.info('manual sweep complete');
process.exit(0);
