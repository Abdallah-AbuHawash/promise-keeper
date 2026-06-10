import { describe, it, expect } from 'vitest';
import { extractJsonObject } from '../src/util/json.js';

describe('extractJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a ```json fenced block', () => {
    const text = 'Here you go:\n```json\n{"a":2,"b":"x"}\n```\nDone.';
    expect(extractJsonObject(text)).toEqual({ a: 2, b: 'x' });
  });

  it('parses an object embedded in prose', () => {
    expect(extractJsonObject('result is {"ok":true} thanks')).toEqual({ ok: true });
  });

  it('throws when there is no JSON', () => {
    expect(() => extractJsonObject('no json here')).toThrow();
  });
});
