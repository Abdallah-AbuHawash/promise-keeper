import { describe, it, expect } from 'vitest';
import { dueDateToEpoch, formatDue } from '../src/util/dates.js';

describe('dueDateToEpoch', () => {
  it('parses a YYYY-MM-DD date to end-of-business epoch', () => {
    const ms = dueDateToEpoch('2026-06-12');
    expect(ms).toBe(Date.parse('2026-06-12T17:00:00'));
  });

  it('returns null for null/empty/garbage', () => {
    expect(dueDateToEpoch(null)).toBeNull();
    expect(dueDateToEpoch('')).toBeNull();
    expect(dueDateToEpoch('not-a-date')).toBeNull();
  });
});

describe('formatDue', () => {
  it('labels a missing due date', () => {
    expect(formatDue(null)).toBe('no due date');
  });

  it('formats a real timestamp to a non-empty string', () => {
    expect(formatDue(Date.parse('2026-06-12T17:00:00'))).toMatch(/2026/);
  });
});
