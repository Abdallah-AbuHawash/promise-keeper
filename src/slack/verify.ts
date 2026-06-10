import { createHmac, timingSafeEqual } from 'node:crypto';

/** Reject requests whose timestamp is older than this (replay protection). */
const MAX_SKEW_SECONDS = 60 * 5;

/**
 * Verify a Slack Events API request signature.
 *
 * Slack signs `v0:{timestamp}:{rawBody}` with HMAC-SHA256 using the app's
 * signing secret and sends it as `x-slack-signature: v0=<hex>`. We must hash
 * the *raw* body bytes — re-serializing parsed JSON would change them.
 */
export function verifySlackSignature(opts: {
  signingSecret: string;
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: string;
  nowSeconds?: number;
}): boolean {
  const { signingSecret, signature, timestamp, rawBody } = opts;
  if (!signature || !timestamp) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac('sha256', signingSecret).update(base).digest('hex')}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
