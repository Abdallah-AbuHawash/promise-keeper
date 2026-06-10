import { describe, it, expect } from 'vitest';
import {
  createCommitment,
  getLinkBySlackUser,
  linkUser,
  type NewCommitment,
} from '../src/db/index.js';
import type { ExtractedCommitment } from '../src/types.js';

const extracted: ExtractedCommitment = {
  deliverable: 'Send report',
  customer: 'Acme',
  dueDate: '2026-06-12',
  priority: 'high',
  confidence: 0.9,
  quote: 'q',
  reasoning: 'r',
};

function newCommitment(ts: string): NewCommitment {
  return {
    source: 'pin',
    slackChannelId: 'C1',
    slackMessageTs: ts,
    slackThreadTs: null,
    slackUserId: 'U1',
    slackPermalink: null,
    extracted,
    dueAt: Date.parse('2026-06-12T17:00:00'),
  };
}

describe('createCommitment dedup', () => {
  it('inserts once and ignores a duplicate Slack message', () => {
    const first = createCommitment(newCommitment('111.0001'));
    expect(first).not.toBeNull();

    const dup = createCommitment(newCommitment('111.0001'));
    expect(dup).toBeNull();

    const other = createCommitment(newCommitment('222.0002'));
    expect(other).not.toBeNull();
  });
});

describe('user links', () => {
  it('links and resolves a Slack user to a Telegram chat', () => {
    linkUser('U999', 424242, 'Abdalla');
    const link = getLinkBySlackUser('U999');
    expect(link?.telegram_chat_id).toBe(424242);
  });
});
