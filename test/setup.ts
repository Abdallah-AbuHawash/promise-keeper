// Provide the env config.ts requires, so modules that import it can be tested.
// Runs before any test file imports application code.
process.env.ANTHROPIC_API_KEY ||= 'test-key';
process.env.TELEGRAM_BOT_TOKEN ||= '123:test';
process.env.SLACK_SIGNING_SECRET ||= 'test-secret';
process.env.SLACK_BOT_TOKEN ||= 'xoxb-test';
process.env.CLICKUP_TOKEN ||= 'pk_test';
process.env.CLICKUP_LIST_ID ||= '900';
process.env.DATABASE_PATH = ':memory:';
process.env.SWEEP_MIN_CONFIDENCE ||= '0.5';
