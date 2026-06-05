import { describe, expect, it } from 'vitest';
import { __test } from './client';

describe('loki parseStreams', () => {
  it('flattens stream values into time-sorted lines (ns → ms)', () => {
    const lines = __test.parseStreams([
      { values: [['2000000', 'second']] },
      { values: [['1000000', 'first']] },
    ]);
    expect(lines).toEqual([
      { ts: 1, line: 'first' },
      { ts: 2, line: 'second' },
    ]);
  });

  it('handles empty / missing values', () => {
    expect(__test.parseStreams(undefined)).toEqual([]);
    expect(__test.parseStreams([{}])).toEqual([]);
  });
});
