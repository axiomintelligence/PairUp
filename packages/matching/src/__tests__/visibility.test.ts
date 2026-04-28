import { describe, expect, it } from 'vitest';
import {
  candidateSatisfiesSearcherGates,
  candidateVisibleToSearcher,
  userVisibleToCandidate,
} from '../visibility.js';
import { fullWeek, makeProfile, openVisibility, strictVisibility, thuFri } from './fixtures.js';
import type { SearchPrefs } from '../types.js';

describe('candidateVisibleToSearcher', () => {
  it('candidate with all-open visibility is always visible', () => {
    const searcher = makeProfile({ grade: 'G7' });
    const cand = makeProfile({ grade: 'G6', visibility: openVisibility });
    expect(candidateVisibleToSearcher(searcher, cand)).toBe(true);
  });

  it('candidate visibility.grade=must hides candidates from a different grade', () => {
    const searcher = makeProfile({ grade: 'G7' });
    const cand = makeProfile({ grade: 'G6', visibility: { ...openVisibility, grade: 'must' } });
    expect(candidateVisibleToSearcher(searcher, cand)).toBe(false);
  });

  it('candidate visibility.directorates=must hides when no overlap', () => {
    const searcher = makeProfile({ directorates: ['Finance'] });
    const cand = makeProfile({
      directorates: ['Programme Delivery'],
      visibility: { ...openVisibility, directorates: 'must' },
    });
    expect(candidateVisibleToSearcher(searcher, cand)).toBe(false);
  });

  it('candidate visibility.days=must hides when day complementarity is below the gate', () => {
    const searcher = makeProfile({ days: fullWeek });
    const cand = makeProfile({
      days: fullWeek,
      visibility: { ...openVisibility, days: 'must' },
    });
    expect(candidateVisibleToSearcher(searcher, cand)).toBe(false);
  });

  it('passes when both sides are strict but compatible', () => {
    const searcher = makeProfile({ grade: 'G7', days: fullWeek, location: 'L', directorates: ['F'] });
    const cand = makeProfile({
      grade: 'G7',
      days: thuFri,
      location: 'L',
      directorates: ['F'],
      visibility: strictVisibility,
    });
    expect(candidateVisibleToSearcher(searcher, cand)).toBe(true);
  });
});

describe('userVisibleToCandidate', () => {
  it('mirrors visibility logic but applied to the user side', () => {
    const user = makeProfile({ grade: 'G7', visibility: { ...openVisibility, grade: 'must' } });
    const cand = makeProfile({ grade: 'G6' });
    expect(userVisibleToCandidate(user, cand)).toBe(false);
  });
});

describe('candidateSatisfiesSearcherGates', () => {
  const allDefinite: SearchPrefs = {
    grade: 'definite',
    directorates: 'definite',
    location: 'definite',
    days: 'definite',
  };

  it('rejects when grade differs and prefs.grade=definite', () => {
    const searcher = makeProfile({ grade: 'G7' });
    const cand = makeProfile({ grade: 'G6' });
    expect(candidateSatisfiesSearcherGates(searcher, cand, allDefinite)).toBe(false);
  });

  it('rejects when directorates do not overlap and prefs.directorates=definite', () => {
    const searcher = makeProfile({ directorates: ['Finance'] });
    const cand = makeProfile({ directorates: ['HR'] });
    expect(candidateSatisfiesSearcherGates(searcher, cand, allDefinite)).toBe(false);
  });

  it('passes when all definite gates are satisfied', () => {
    const searcher = makeProfile({ grade: 'G7', location: 'L', days: fullWeek, directorates: ['F'] });
    const cand = makeProfile({ grade: 'G7', location: 'L', days: thuFri, directorates: ['F'] });
    expect(candidateSatisfiesSearcherGates(searcher, cand, allDefinite)).toBe(true);
  });

  it('preferred-tier prefs do not reject (only "definite" gates are hard)', () => {
    const searcher = makeProfile({ grade: 'G7' });
    const cand = makeProfile({ grade: 'G6' });
    const preferred: SearchPrefs = {
      grade: 'preferred',
      directorates: 'definite',
      location: 'preferred',
      days: 'preferred',
    };
    // Directorates overlap (default fixture); grade is preferred, so accepted.
    expect(candidateSatisfiesSearcherGates(searcher, cand, preferred)).toBe(true);
  });
});
