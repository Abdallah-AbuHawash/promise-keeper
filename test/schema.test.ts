import { describe, it, expect } from 'vitest';
import { ExtractionResultSchema } from '../src/anthropic/schema.js';

describe('ExtractionResultSchema', () => {
  it('parses a well-formed extraction', () => {
    const r = ExtractionResultSchema.parse({
      commitments: [
        {
          deliverable: 'Send Q3 report',
          customer: 'Acme',
          dueDate: '2026-06-12',
          priority: 'high',
          confidence: 0.9,
          quote: "I'll send the Q3 report by Friday",
          reasoning: 'explicit promise with deadline',
          messageTs: '1700000000.0001',
          authorUserId: 'U123',
        },
      ],
      latestTs: '1700000000.0001',
    });
    expect(r.commitments).toHaveLength(1);
    expect(r.commitments[0]!.priority).toBe('high');
  });

  it('coerces an unknown priority to normal', () => {
    const r = ExtractionResultSchema.parse({
      commitments: [
        {
          deliverable: 'x',
          customer: null,
          dueDate: null,
          priority: 'super-urgent',
          confidence: 0.5,
          quote: '',
          reasoning: '',
        },
      ],
    });
    expect(r.commitments[0]!.priority).toBe('normal');
  });

  it('defaults missing commitments to an empty array', () => {
    const r = ExtractionResultSchema.parse({});
    expect(r.commitments).toEqual([]);
  });
});
