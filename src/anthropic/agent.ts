import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { extractJsonObject } from '../util/json.js';
import { todayISO } from '../util/dates.js';
import { ExtractionResultSchema, type ExtractionResultParsed } from './schema.js';
import type { SlackMessage } from '../slack/client.js';

const MODEL = config.ANTHROPIC_MODEL;

/**
 * Adaptive thinking is only valid on 4.6+ Opus/Sonnet and Fable. Haiku 4.5 and
 * older models 400 if we send it — so we gate it by model id.
 */
function supportsAdaptiveThinking(model: string): boolean {
  return /(opus-4-[678]|sonnet-4-6|fable)/.test(model);
}

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const EXTRACTION_SYSTEM = `You detect commitments that support/sales engineers make to customers in Slack.

A "commitment" is anything the engineer promises to deliver or do: send a report, fix a bug, follow up, schedule a call, share a doc, etc. Capture BOTH:
- explicit promises ("I'll send the report by Friday")
- implied follow-ups ("let me check with the team and get back to you")

Rules:
- Resolve relative dates ("by Friday", "tomorrow", "end of next week") to an absolute YYYY-MM-DD using the provided current date. If no date is implied, use null.
- confidence (0-1): how sure you are this is a genuine, trackable commitment the engineer must remember. Casual chatter, questions, and statements the CUSTOMER makes are NOT commitments.
- Each message is prefixed with [ts=… user=…]; copy that ts into messageTs and that user into authorUserId for the message the promise came from.

Respond with ONLY a JSON object (no prose) in this exact shape:
{"commitments":[{"deliverable":"...","customer":"... or null","dueDate":"YYYY-MM-DD or null","priority":"low|normal|high|urgent","confidence":0.0,"quote":"the exact sentence","reasoning":"one line","messageTs":"...","authorUserId":"..."}]}`;

function renderContext(messages: SlackMessage[]): string {
  return messages.map((m) => `[ts=${m.ts} user=${m.user ?? 'unknown'}] ${m.text}`).join('\n');
}

/**
 * Pure LLM extraction over Slack message text already fetched by the caller.
 * Returns structured commitments validated against the zod schema.
 */
async function extract(prompt: string, maxTokens: number): Promise<ExtractionResultParsed> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    ...(supportsAdaptiveThinking(MODEL) ? { thinking: { type: 'adaptive' as const } } : {}),
    system: EXTRACTION_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = res.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();

  return ExtractionResultSchema.parse(extractJsonObject(text));
}

/** Pin lane: the engineer flagged a specific message (+ its thread for context). */
export async function extractFromPin(messages: SlackMessage[]): Promise<ExtractionResultParsed> {
  const prompt = `Current date: ${todayISO()}.
A support engineer flagged the FIRST message below as containing a promise to a customer; the rest is thread context. Extract the commitment(s).

${renderContext(messages)}`;
  const result = await extract(prompt, 4000);
  logger.info({ count: result.commitments.length }, 'pin extraction done');
  return result;
}

/** Sweep lane: scan recent channel messages for promises (explicit + implied). */
export async function extractFromSweep(messages: SlackMessage[]): Promise<ExtractionResultParsed> {
  const prompt = `Current date: ${todayISO()}.
Scan these recent Slack messages and extract every commitment a support/sales engineer made to a customer, including implied follow-ups.

${renderContext(messages)}`;
  const result = await extract(prompt, 8000);
  logger.info({ count: result.commitments.length }, 'sweep extraction done');
  return result;
}
