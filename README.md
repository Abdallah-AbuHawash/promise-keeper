# Promise‑Keeper 🤝

**An internal AI agent for customer‑facing teams.** When a support engineer, presales, or sales rep promises a customer something in Slack — _“I’ll send the report by Friday”, “let me check with the team and get back to you”_ — that commitment lives in a chat thread and quietly gets dropped. Promise‑Keeper watches Slack, uses Claude to extract the promises (the explicit ones **and** the implied follow‑ups), and turns each into a tracked **ClickUp** task — but only after the engineer confirms it from **Telegram**, where they also get reminders and can close the task with one tap.

> Built for the Open ([open.cx](https://www.open.cx/)) interview. Open’s platform automates customer support across many channels but doesn’t capture the commitments its own teams make to customers — and Telegram isn’t one of its channels. This fills both gaps.

---

## Try it in 30 seconds

The whole agent loop is demoable from Telegram with **no Slack or ClickUp setup**:

1. Open the bot: **[@PrmseKprBot](https://t.me/PrmseKprBot)**
2. Send **`/demo`**.

The bot injects a realistic sample promise, runs the **real** Claude extraction, and sends you an approval card. Tap **✅ Create task** to create a **real ClickUp task** and get the link back. `/demo` again for a different sample.

To see the real Slack 📌 → Telegram → ClickUp flow, see the short clip below _(or wire your own workspace via Setup)_:

<!-- ![demo](docs/demo.gif) -->

---

## Why this use case

Open grades on **the tools used**, **attention to detail**, and **how good the agent is at its job**. Promise‑Keeper is deliberately tool‑dense and built around a real workflow:

- **Claude (Opus 4.8) with adaptive thinking** extracts commitments from Slack text — explicit promises and implied follow‑ups — with relative‑date resolution and confidence scoring.
- **Slack** — Events API webhook for the real‑time 📌 trigger, plus Web API reads (`conversations.history` / `replies`, permalinks).
- **ClickUp REST API v2** — create tasks, resolve the list’s closed status, and close on completion.
- **Telegram inline‑keyboard UX** as the human‑in‑the‑loop approval, reminder, and close‑out surface.
- **A scheduler** for the hourly sweep, due‑date reminders, and a daily digest.
- **SQLite** for state, dedup, cursors, and an audit log.

> **Why REST and not MCP?** Both the ClickUp MCP and Slack MCP servers authenticate with **OAuth only** — ClickUp explicitly refuses API keys and allowlists vetted MCP‑client redirect URIs; Slack uses a confidential OAuth app flow. Anthropic’s MCP connector only carries a **static bearer token** and can’t run an interactive OAuth/PKCE flow, so a custom client can’t drive those servers. The pragmatic, reliable choice for a working agent is to call the services’ REST APIs directly. The integration layer is adapter‑shaped (`src/slack/client.ts`, `src/clickup/client.ts`), so it can be swapped for MCP under a managed‑agent + vault setup later without touching the pipeline.

---

## How it works

Two lanes feed one pipeline:

```
 Lane A — real-time          Lane B — safety net
 ┌───────────────────┐       ┌───────────────────────┐
 │ Engineer reacts 📌 │       │ Hourly cron sweep      │
 │ on a Slack message │       │ (per-channel cursor)   │
 └─────────┬─────────┘       └───────────┬───────────┘
           │ Slack Events webhook         │ Slack Web API: history since cursor
           ▼                              ▼
        ┌──────────────────────────────────────────┐
        │  Claude (Opus 4.8) extraction              │
        │  → commitments (explicit + implied)        │
        │    deliverable · customer · due · priority │
        │    · confidence · quote · reasoning        │
        └─────────────────────┬──────────────────────┘
                              ▼
        ┌──────────────────────────────────────────┐
        │  Telegram approval card  [✅ Create]       │
        │  [✏️ Edit] [💤 Snooze] [🗑 Dismiss]         │
        └─────────────────────┬──────────────────────┘
                  ✅ approved  ▼
        ┌──────────────────────────────────────────┐
        │  ClickUp REST API → create task           │
        └─────────────────────┬──────────────────────┘
                              ▼
        ┌──────────────────────────────────────────┐
        │  Reminder before due  → [✔️ Done]/[💤]     │
        │  Done → ClickUp REST API → close task     │
        │  Daily digest of open / overdue items     │
        └──────────────────────────────────────────┘
```

- **Pin (📌)** is intentional and instant → high trust.
- **The hourly sweep** is the safety net for promises nobody pinned, and is where **implied** follow‑ups get caught. The LLM is the filter — there is **no keyword regex**. Lower‑confidence swept items are flagged as guesses on the card and gated by a confidence threshold.
- **Nothing is written to ClickUp without a human tap.** The agent proposes; the engineer disposes.

### Why a webhook _and_ a sweep

The **Events API webhook** is the push doorbell — it fires the instant someone reacts 📌, giving real‑time, intentional capture. The **sweep** (Slack Web API + a per‑channel cursor, every 5 min) is the pull‑based safety net that catches promises nobody pinned and surfaces implied follow‑ups. Pin = high trust; sweep = best‑effort with a confidence gate.

### Reverse sync — closing the loop

The flow is bidirectional. When an engineer closes the task **directly in ClickUp**, a ClickUp `taskStatusUpdated` webhook (`src/clickup/webhook.ts`) marks the commitment done, pings the engineer on Telegram, and — if `SLACK_POST_ON_CLOSE` is on — posts **“✅ Resolved: …” back into the original Slack thread**, so the customer sees it without anyone re‑typing. A `markDoneIfOpen` guard transitions each commitment exactly once, so closing from Telegram and the resulting ClickUp echo never double‑fire.

---

## Project layout

```
src/
  index.ts            boot: Hono webhook server + grammY bot + cron jobs
  config.ts           zod-validated env (fails loudly on misconfig)
  logger.ts           pino structured logging
  types.ts            domain types
  pipeline.ts         shared sink for both lanes (dedup, confidence gate, routing)
  db/
    schema.sql        SQLite schema
    index.ts          prepared-statement repo
  anthropic/
    agent.ts          Claude extraction (structured commitment output)
    schema.ts         zod contracts for model output
  slack/
    verify.ts         Events API HMAC signature verification
    webhook.ts        Hono route: url_verification + reaction_added (Lane A)
    client.ts         Slack Web API: history, thread, permalink, display name
  clickup/
    client.ts         ClickUp REST API: create / close task
    webhook.ts        ClickUp webhook receiver (reverse-sync on task close)
  telegram/
    bot.ts            grammY bot: linking, approval/reminder cards, actions
    cards.ts          message + inline-keyboard rendering
  jobs/
    reminders.ts      due reminders + snooze revival
    digest.ts         daily per-engineer digest
  scripts/
    run-sweep.ts      run the sweep once (npm run sweep)
test/                 vitest: signature, dates, JSON, schema, dedup
```

---

## Setup

### Prerequisites

- Node ≥ 20
- An Anthropic API key
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A Slack app (signing secret + a token with read scopes)
- A ClickUp personal API token (`pk_…`) and a target list id

### 1. Install

```bash
npm install
cp .env.example .env   # then fill it in
```

Every variable is documented in `.env.example` and validated at boot — a missing or malformed value prints exactly what’s wrong and exits.

### 2. Telegram

Create a bot with @BotFather, put the token in `TELEGRAM_BOT_TOKEN`. The bot uses long polling, so no public URL is needed for Telegram.

### 3. Slack app

- **Signing secret** → `SLACK_SIGNING_SECRET`. A token with read scopes → `SLACK_BOT_TOKEN` (a user `xoxp-…` or bot `xoxb-…` token). Required scopes: `channels:history`, `groups:history`, `reactions:read`, `users:read`.
- **Event Subscriptions** → Request URL: `https://<your-public-host>/slack/events`. Subscribe to **`reaction_added`**. Add the bot/user to the channels you want watched and list their IDs in `SLACK_WATCH_CHANNELS`.
- For local development, expose the port with a tunnel:
  ```bash
  ngrok http 3000        # use the https URL as your Slack Request URL
  ```
- `SLACK_TRIGGER_EMOJI` is the reaction that flags a promise (default `pushpin` = 📌).

### 4. ClickUp

- Create a personal API token (ClickUp → Settings → Apps → API Token, starts with `pk_`) → `CLICKUP_TOKEN`.
- Pick the list new tasks should land in → `CLICKUP_LIST_ID` (open the list; the id is in the URL).

### 5. Reverse sync (optional)

To get the ClickUp‑close → Telegram + Slack confirmation:

```bash
npm run setup:webhook -- https://<your-host>/clickup/webhook
```

It registers a `taskStatusUpdated` webhook and prints a secret → set `CLICKUP_WEBHOOK_SECRET` and redeploy. For the Slack thread reply, the token needs the `chat:write` scope (set `SLACK_POST_ON_CLOSE=false` to notify Telegram only).

### 6. Run

```bash
npm run dev      # watch mode
npm start        # one-shot
npm run sweep    # run the Slack sweep once (handy for demos)
npm test         # unit tests
npm run lint     # eslint
npm run typecheck
```

---

## Deploy (Railway)

The bot uses Telegram long-polling, so it runs as a plain worker — **no public URL needed** for `/demo`, `/link`, reminders, and the sweep. (Only the real-time Slack 📌 webhook needs the tunnel/host URL.)

1. Push this repo to GitHub.
2. [Railway](https://railway.app) → **New Project → Deploy from GitHub repo**. It auto-detects the `Dockerfile` (`railway.json` pins this).
3. Add the environment variables from `.env.example` in the Railway **Variables** tab (at minimum `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `TELEGRAM_BOT_TOKEN`, `CLICKUP_TOKEN`, `CLICKUP_LIST_ID`; add the Slack vars to enable the 📌 lane).
4. Deploy. Logs show `telegram bot started` → message the bot and send `/demo`.

> The SQLite file lives on the container's ephemeral disk and resets on redeploy (fine for a demo — re-link and re-run). Attach a Railway volume and point `DATABASE_PATH` at it to persist.

---

## Using it

0. **Quickest:** send **`/demo`** — runs a sample promise through the full pipeline, no setup. (See "Try it in 30 seconds" above.)
1. In Telegram, open your bot and link your Slack identity: `/link U0123ABC` (Slack → Profile → ⋯ → _Copy member ID_).
2. In a watched Slack channel, make a promise to a customer and react with **📌** (or wait for the hourly sweep).
3. An approval card arrives in Telegram. Tap **✅ Create task** to push it to ClickUp, **✏️ Edit** to fix the title/date, **💤 Snooze**, or **🗑 Dismiss**.
4. Before the due time you get a reminder; tap **✔️ Done** to close the ClickUp task.
5. `/list` shows your open commitments; a daily digest summarizes overdue/at‑risk ones.

---

## Design & detail notes

- **Idempotent by Slack message.** A `UNIQUE(channel, message_ts)` index means the same promise can’t be created twice — the pin and sweep lanes can’t collide, and Slack’s webhook retries are harmless.
- **Sweep dedup + cursor.** Each channel tracks the last processed `ts`; processed messages are recorded so the cron never re‑evaluates one, and a pinned message is never re‑surfaced by the sweep.
- **Confidence gating.** Swept items below `SWEEP_MIN_CONFIDENCE` are dropped; cards show a “low confidence — double‑check” note under 60 %.
- **Graceful failures.** MCP / ClickUp errors leave the commitment in `pending_approval` and tell the engineer to retry — nothing is silently lost. The Anthropic SDK retries transient errors with backoff.
- **Replay‑safe webhook.** Slack signatures are verified over the raw body with a 5‑minute timestamp window using a constant‑time compare.
- **Observability.** Structured pino logs throughout, plus an append‑only `audit_log` of every state change.
- **Snooze that does the right thing.** Snoozing a not‑yet‑approved item re‑surfaces the approval card later; snoozing a created task re‑arms its reminder.

### Known assumptions / scope

- The pin lane attributes the promise to the **reactor** (assumes engineers pin their own messages); the sweep attributes to the message author. The design is team‑capable (Slack ↔ Telegram user map) but is demoed with a single linked user.
- The sweep reads up to the 50 most recent messages newer than the channel cursor per run; very high‑volume channels would want pagination.
- ClickUp “close” resolves the list’s `closed`/`done` status dynamically and falls back to `complete` if the list’s statuses can’t be read.

---

## Tech

TypeScript · [grammY](https://grammy.dev) · [Hono](https://hono.dev) · [@anthropic-ai/sdk](https://www.npmjs.com/package/@anthropic-ai/sdk) (Opus 4.8) · Slack Web/Events API · ClickUp REST API v2 · better‑sqlite3 · node‑cron · pino · zod · vitest.
