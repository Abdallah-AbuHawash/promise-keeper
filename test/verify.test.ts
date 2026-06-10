import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySlackSignature } from '../src/slack/verify.js';

const secret = 'top-secret';
const body = '{"type":"event_callback"}';

function sign(ts: string, rawBody: string, key = secret): string {
  return `v0=${createHmac('sha256', key).update(`v0:${ts}:${rawBody}`).digest('hex')}`;
}

describe('verifySlackSignature', () => {
  const now = 1_900_000_000; // fixed reference (seconds)
  const ts = String(now);

  it('accepts a correctly signed request', () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(ts, body),
        timestamp: ts,
        rawBody: body,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(ts, body),
        timestamp: ts,
        rawBody: body + 'x',
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('rejects a wrong signing secret', () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(ts, body, 'other'),
        timestamp: ts,
        rawBody: body,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('rejects a stale timestamp (replay)', () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(ts, body),
        timestamp: ts,
        rawBody: body,
        nowSeconds: now + 60 * 10, // 10 minutes later
      }),
    ).toBe(false);
  });

  it('rejects missing signature/timestamp', () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: undefined,
        timestamp: ts,
        rawBody: body,
        nowSeconds: now,
      }),
    ).toBe(false);
  });
});
