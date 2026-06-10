# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repo.

## What this is

**Promise-Keeper** — an internal agent for customer-facing teams. It captures commitments engineers make to customers in **Slack**, uses **Claude** to extract them (explicit + implied), and turns approved ones into **ClickUp** tasks. **Telegram** is the human-in-the-loop approval / reminder / close-out surface. See `README.md` for the full write-up.

## Commands

```bash
npm run dev        # run with tsx watch (auto-reload)
npm start          # run once (used in the Docker image / Railway)
npm run sweep      # run the Slack sweep one time (demo/debug)
npm test           # vitest unit tests
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # tsc → dist/
```

Before committing changes, run `npm run typecheck && npm run lint && npm test`.

## Architecture

Two capture lanes converge on one pipeline (`src/pipeline.ts`):

- **Pin lane** (real-time): Slack `reaction_added` 📌 → `src/slack/webhook.ts` → `handlePin`.
- **Sweep lane** (cron): `src/slack/client.ts#getHistorySince` (per-channel cursor) → `runSweep`.

Both: fetch Slack text → `src/anthropic/agent.ts` (Claude → structured commitments) → Telegram approval card (`src/telegram/`) → on approval, `src/clickup/client.ts` creates the task. Reminders + daily digest run from `src/jobs/`. State in SQLite (`src/db/`).

```
src/
  index.ts            boot: Hono webhook + grammY bot + cron
  config.ts           zod-validated env (fails fast)
  pipeline.ts         shared ingest for both lanes (dedup, confidence gate, routing)
  anthropic/agent.ts  Claude extraction (no MCP — see "Why REST" below)
  slack/              verify.ts (HMAC), webhook.ts (events), client.ts (Web API reads)
  clickup/client.ts   ClickUp REST v2 (create / close)
  telegram/           bot.ts (commands + actions + /demo), cards.ts (rendering)
  jobs/               reminders.ts, digest.ts
  db/                 schema.sql + index.ts (prepared-statement repo)
```

## Conventions

- TypeScript, **ESM** (`"type": "module"`), strict tsconfig with `noUncheckedIndexedAccess`. Import local files with the `.js` extension.
- All config goes through `src/config.ts` (zod). Never read `process.env` directly elsewhere.
- Logging via `pino` (`src/logger.ts`) — structured, no `console.log`.
- Timestamps are **epoch milliseconds** everywhere.
- Model output is parsed with `extractJsonObject` + validated by zod schemas in `src/anthropic/schema.ts` (tolerant: `.catch()` defaults rather than throwing).

## Key decisions / gotchas

- **Why REST, not MCP:** ClickUp + Slack MCP servers are OAuth-only (ClickUp also allowlists MCP-client redirect URIs); Anthropic's MCP connector only carries a static bearer token, so a custom client can't drive them. We call the REST APIs directly. The integration layer is adapter-shaped so it could move to MCP under a managed-agent + vault setup later.
- **Model is env-driven** (`ANTHROPIC_MODEL`, default `claude-opus-4-8`). Adaptive thinking is gated by `supportsAdaptiveThinking()` in `agent.ts` — Haiku 4.5 would 400 on `thinking: {type:'adaptive'}`, so it's omitted for Haiku.
- **ClickUp close** resolves the list's terminal status by picking the highest-`orderindex` `done`/`closed`-type status (lists can have several oddly-named closed statuses).
- **Dedup** is enforced by a `UNIQUE(slack_channel_id, slack_message_ts)` index — the pin and sweep lanes can't double-create, and Slack webhook retries are harmless.
- **SQLite is ephemeral** on Railway (resets on redeploy) unless a volume is attached at `DATABASE_PATH`.
- `/demo` (in `telegram/bot.ts`) runs a sample promise through the real pipeline with no Slack/ClickUp setup — the quickest way to see the agent work.

## Testing

Unit tests in `test/` cover Slack signature verification, due-date parsing, JSON extraction, the zod schema, and DB dedup. `test/setup.ts` injects dummy env + an in-memory DB so config-dependent modules import cleanly.
