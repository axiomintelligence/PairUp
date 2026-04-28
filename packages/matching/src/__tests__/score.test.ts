import { describe, expect, it } from 'vitest';
import { rankScore, scoreMatch, compareForCursor } from '../score.js';
import { makeProfile, NOW, fullWeek, thuFri } from './fixtures.js';
import type { SearchPrefs } from '../types.js';

const definitePrefs: SearchPrefs = {
  grade: 'definite',
  directorates: 'definite',
  location: 'preferred',
  days: 'preferred',
};

const preferredPrefs: SearchPrefs = {
  grade: 'preferred',
  directorates: 'preferred',
  location: 'preferred',
  days: 'preferred',
};

describe('rankScore', () => {
  it('returns 0..100 integer', () => {
    const user = makeProfile();
    const cand = makeProfile();
    const { score } = rankScore(user, cand, { now: NOW });
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('exposes breakdown entries with score ≤ max', () => {
    const user = makeProfile();
    const cand = makeProfile({ days: thuFri });
    const { breakdown } = rankScore(user, cand, { now: NOW });
    for (const entry of breakdown) {
      expect(entry.score).toBeLessThanOrEqual(entry.max);
      expect(entry.score).toBeGreaterThanOrEqual(0);
    }
    // Day pattern is always included
    expect(breakdown.some((e) => e.label === 'Day pattern')).toBe(true);
  });

  it('day-complementary candidate scores higher than identical-pattern candidate', () => {
    const user = makeProfile();
    const complementary = makeProfile({ days: thuFri });
    const same = makeProfile({ days: user.days });
    expect(rankScore(user, complementary, { now: NOW }).score)
      .toBeGreaterThan(rankScore(user, same, { now: NOW }).score);
  });

  it('same location with preferred prefs adds 15 (10 base + 5 preferred bonus)', () => {
    // Default fixture's prefs has location: 'preferred', so same-location triggers
    // both the 10-pt base scoring AND the 5-pt preferred bonus.
    const user = makeProfile({ location: 'London – KCS' });
    const same = makeProfile({ location: 'London – KCS', days: thuFri });
    const diff = makeProfile({ location: 'East Kilbride', days: thuFri });
    const sameScore = rankScore(user, same, { now: NOW }).score;
    const diffScore = rankScore(user, diff, { now: NOW }).score;
    expect(sameScore - diffScore).toBe(15);
  });

  it('same location with definite-only prefs adds just the 10 base pts', () => {
    const user = makeProfile({ location: 'London – KCS' });
    const same = makeProfile({ location: 'London – KCS', days: thuFri });
    const diff = makeProfile({ location: 'East Kilbride', days: thuFri });
    const definiteOnly: SearchPrefs = {
      grade: 'definite',
      directorates: 'definite',
      location: 'definite',
      days: 'definite',
    };
    const sameScore = rankScore(user, same, { prefs: definiteOnly, now: NOW }).score;
    const diffScore = rankScore(user, diff, { prefs: definiteOnly, now: NOW }).score;
    expect(sameScore - diffScore).toBe(10);
  });

  it('preferred-grade bonus only triggers when both prefs.grade === preferred AND grades match', () => {
    const user = makeProfile({ grade: 'G7' });
    const cand = makeProfile({ grade: 'G7', days: thuFri });
    const baseline = rankScore(user, cand, { prefs: definitePrefs, now: NOW }).score;
    const withBonus = rankScore(user, cand, { prefs: preferredPrefs, now: NOW }).score;
    expect(withBonus).toBeGreaterThan(baseline);
  });

  it('grade penalty only fires for adjacent grades in preferred mode', () => {
    const user = makeProfile({ grade: 'G7' });
    const adjacent = makeProfile({ grade: 'G6', days: thuFri });
    const distant = makeProfile({ grade: 'AA/AO', days: thuFri });
    const adjacentHeavy = rankScore(user, adjacent, { prefs: preferredPrefs, now: NOW }).score;
    const distantHeavy = rankScore(user, distant, { prefs: preferredPrefs, now: NOW }).score;
    // Distant grade is NOT penalised (HLD §6 grade adjacency = 1 only); adjacent gets halved.
    expect(adjacentHeavy).toBeLessThan(distantHeavy);
  });

  it('grade-penalty=none keeps the score the same as a same-grade match would', () => {
    const user = makeProfile({ grade: 'G7' });
    const adj = makeProfile({ grade: 'G6', days: thuFri });
    const heavy = rankScore(user, adj, {
      prefs: preferredPrefs,
      weights: { gradePenalty: 'heavy' },
      now: NOW,
    }).score;
    const none = rankScore(user, adj, {
      prefs: preferredPrefs,
      weights: { gradePenalty: 'none' },
      now: NOW,
    }).score;
    expect(none).toBeGreaterThan(heavy);
  });

  it('recency tiers move the score in the right direction', () => {
    const user = makeProfile();
    const recent = makeProfile({
      days: thuFri,
      lastActiveAt: new Date(NOW.getTime() - 5 * 86_400_000),
    });
    const stale = makeProfile({
      days: thuFri,
      lastActiveAt: new Date(NOW.getTime() - 200 * 86_400_000),
    });
    expect(rankScore(user, recent, { now: NOW }).score)
      .toBeGreaterThan(rankScore(user, stale, { now: NOW }).score);
  });

  it('daysNegotiable bumps the score (yes > possibly > no)', () => {
    const user = makeProfile();
    const yes = makeProfile({ days: thuFri, daysNegotiable: 'yes' });
    const possibly = makeProfile({ days: thuFri, daysNegotiable: 'possibly' });
    const no = makeProfile({ days: thuFri, daysNegotiable: 'no' });
    const yesScore = rankScore(user, yes, { now: NOW }).score;
    const possiblyScore = rankScore(user, possibly, { now: NOW }).score;
    const noScore = rankScore(user, no, { now: NOW }).score;
    expect(yesScore).toBeGreaterThan(possiblyScore);
    expect(possiblyScore).toBeGreaterThan(noScore);
  });

  it('full-week vs full-week gets a low overall score (no day complementarity)', () => {
    const user = makeProfile({ days: fullWeek });
    const cand = makeProfile({ days: fullWeek });
    const { score } = rankScore(user, cand, { now: NOW });
    expect(score).toBeLessThan(60);
  });

  it('scoreMatch is an alias for rankScore', () => {
    const user = makeProfile();
    const cand = makeProfile({ days: thuFri });
    expect(scoreMatch(user, cand, { now: NOW })).toEqual(rankScore(user, cand, { now: NOW }));
  });
});

describe('compareForCursor', () => {
  it('orders by score descending, then user_id ascending — stable for HLD §7.2 cursor', () => {
    const xs = [
      { score: 80, userId: 'b' },
      { score: 80, userId: 'a' },
      { score: 90, userId: 'z' },
    ];
    xs.sort(compareForCursor);
    expect(xs).toEqual([
      { score: 90, userId: 'z' },
      { score: 80, userId: 'a' },
      { score: 80, userId: 'b' },
    ]);
  });
});
