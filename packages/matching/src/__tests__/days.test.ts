import { describe, expect, it } from 'vitest';
import {
  dayComplementarity,
  sharedDirectorates,
  directorateOverlapAny,
} from '../days.js';
import { allFlexible, fullWeek, monTueWed, thuFri } from './fixtures.js';

describe('dayComplementarity', () => {
  it('two identical full-week patterns have zero complementarity', () => {
    expect(dayComplementarity(fullWeek, fullWeek)).toBe(0);
  });

  it('full week vs all-flexible scores 0.8 (DAY_PAIR_SCORES["full+flexible"])', () => {
    expect(dayComplementarity(fullWeek, allFlexible)).toBeCloseTo(0.8, 5);
  });

  it('Mon/Tue/Wed-leaning meets Thu/Fri-leaning above the 0.3 day-gate threshold', () => {
    const score = dayComplementarity(monTueWed, thuFri);
    expect(score).toBeGreaterThan(0.3);
  });

  it('treats null/undefined as EMPTY_DAYS (all "non") — non+non = 0.2', () => {
    expect(dayComplementarity(null, undefined)).toBeCloseTo(0.2, 5);
  });

  it('is symmetric: comp(a, b) == comp(b, a)', () => {
    expect(dayComplementarity(monTueWed, thuFri)).toBeCloseTo(
      dayComplementarity(thuFri, monTueWed),
      10,
    );
  });
});

describe('sharedDirectorates', () => {
  it('returns the intersection of two normal lists', () => {
    expect(sharedDirectorates(['Economic & Trade', 'Finance'], ['Finance', 'HR']))
      .toEqual(['Finance']);
  });

  it('"Open to any" on the candidate widens overlap to the user list', () => {
    expect(sharedDirectorates(['Finance', 'HR'], ['Open to any']))
      .toEqual(['Finance', 'HR']);
  });

  it('"Open to any" on the user widens overlap to the candidate list', () => {
    expect(sharedDirectorates(['Open to any'], ['Finance', 'HR']))
      .toEqual(['Finance', 'HR']);
  });

  it('"Open to any" on both sides is the deduplicated union of the rest', () => {
    expect(sharedDirectorates(['Open to any', 'Finance'], ['Open to any', 'Finance', 'HR']))
      .toEqual(['Finance', 'HR']);
  });

  it('handles null/undefined as empty', () => {
    expect(sharedDirectorates(undefined, null)).toEqual([]);
  });
});

describe('directorateOverlapAny', () => {
  it('true when at least one directorate overlaps', () => {
    expect(directorateOverlapAny(['Finance'], ['Finance', 'HR'])).toBe(true);
  });

  it('false when no overlap', () => {
    expect(directorateOverlapAny(['Finance'], ['HR'])).toBe(false);
  });

  it('"Open to any" on either side counts as overlap', () => {
    expect(directorateOverlapAny(['Open to any'], ['HR'])).toBe(true);
    expect(directorateOverlapAny(['Finance'], ['Open to any'])).toBe(true);
  });
});
