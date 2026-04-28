import {
  DEFAULT_SEARCH_PREFS,
  DEFAULT_WEIGHTS,
  GRADE_INDEX,
} from './constants.js';
import { dayComplementarity, sharedDirectorates } from './days.js';
import type {
  GradePenalty,
  MatchWeights,
  Profile,
  ScoreBreakdownEntry,
  ScoreResult,
  SearchPrefs,
} from './types.js';

const DAY_PTS_MAX = 40;
const DIR_PTS_MAX = 20;
const RECENCY_PTS_MAX = 20;
const LOC_PTS_MAX = 10;
const PREF_BONUS_MAX = 30;

const GRADE_PENALTY_FACTOR: Readonly<Record<GradePenalty, number>> = {
  hard: 1.0,
  heavy: 0.5,
  light: 0.25,
  none: 0,
};

export interface ScoreOptions {
  prefs?: SearchPrefs;
  weights?: MatchWeights;
  /** Reference time for recency scoring; default `new Date()`. */
  now?: Date;
}

/**
 * Score a candidate profile against a viewer profile. Returns a 0..100 integer
 * score plus a per-dimension breakdown for the UI / `/api/matches/:id/dismiss`
 * tooltip.
 *
 * Pure function — no I/O, no localStorage, no DB. Lifted unchanged in
 * behaviour from `apps/web-static/app.js` Phase 0 (`rankScore`); see the
 * companion test suite for parity coverage.
 */
export function rankScore(
  user: Profile,
  candidate: Profile,
  opts: ScoreOptions = {},
): ScoreResult {
  const prefs = opts.prefs ?? DEFAULT_SEARCH_PREFS;
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const now = opts.now ?? new Date();
  let score = 0;
  const breakdown: ScoreBreakdownEntry[] = [];

  // Day complementarity (0..40 pts)
  const dayComp = dayComplementarity(user.days, candidate.days);
  const dayPts = Math.round(dayComp * DAY_PTS_MAX);
  score += dayPts;
  breakdown.push({
    label: 'Day pattern',
    score: dayPts,
    max: DAY_PTS_MAX,
    note:
      dayComp >= 0.7
        ? 'Strong complementarity'
        : dayComp >= 0.4
          ? 'Partial complementarity'
          : 'Weak complementarity',
  });

  // Directorate overlap (0..20 pts)
  const sharedDirs = sharedDirectorates(user.directorates, candidate.directorates);
  const dirPts = Math.min(sharedDirs.length * 7, DIR_PTS_MAX);
  score += dirPts;
  breakdown.push({
    label: 'Directorate overlap',
    score: dirPts,
    max: DIR_PTS_MAX,
    note: sharedDirs.length > 0 ? sharedDirs.slice(0, 2).join(', ') : 'Minimum overlap',
  });

  // Recency (0..20 pts)
  const lastActiveMs = candidate.lastActiveAt?.getTime() ?? 0;
  const ageDays = (now.getTime() - lastActiveMs) / 86_400_000;
  let recencyPts = 0;
  let recencyNote: string;
  if (ageDays < 14) {
    recencyPts = 20;
    recencyNote = 'Active recently';
  } else if (ageDays < 90) {
    recencyPts = 15;
    recencyNote = 'Active this quarter';
  } else if (ageDays < 180) {
    recencyPts = 5;
    recencyNote = 'Active a few months ago';
  } else {
    recencyNote = 'Not active for 6+ months';
  }
  score += recencyPts;
  breakdown.push({
    label: 'Recency',
    score: recencyPts,
    max: RECENCY_PTS_MAX,
    note: recencyNote,
  });

  // Location match (0..10 pts)
  let locPts = 0;
  if (user.location && candidate.location === user.location) locPts = LOC_PTS_MAX;
  score += locPts;
  breakdown.push({
    label: 'Location',
    score: locPts,
    max: LOC_PTS_MAX,
    note: locPts > 0 ? 'Same location' : 'Different location',
  });

  // Preferred-criteria bonuses (0..30 pts) — only fire when the dimension is
  // set to "preferred" in the searcher's prefs and the candidate satisfies it.
  let prefBonus = 0;
  if (prefs.grade === 'preferred' && candidate.grade === user.grade) prefBonus += 10;
  if (prefs.directorates === 'preferred' && sharedDirs.length > 0) prefBonus += 8;
  if (prefs.location === 'preferred' && candidate.location === user.location) prefBonus += 5;
  if (prefs.days === 'preferred' && dayComp > 0.5) prefBonus += 7;
  if (prefBonus > 0) {
    score += prefBonus;
    breakdown.push({
      label: 'Preferred bonuses',
      score: prefBonus,
      max: PREF_BONUS_MAX,
      note: 'From your search preferences',
    });
  }

  // Grade-penalty (preferred mode only, adjacent grades only — admin-tuned).
  if (prefs.grade === 'preferred' && candidate.grade !== user.grade) {
    const uIdx = GRADE_INDEX[user.grade];
    const cIdx = GRADE_INDEX[candidate.grade];
    if (Math.abs((uIdx ?? 0) - (cIdx ?? 0)) === 1) {
      const factor = GRADE_PENALTY_FACTOR[weights.gradePenalty] ?? GRADE_PENALTY_FACTOR.heavy;
      score = Math.round(score * (1 - factor));
    }
  }

  // Days-negotiable bonus (small finger on scale).
  if (candidate.daysNegotiable === 'yes') score += 3;
  else if (candidate.daysNegotiable === 'possibly') score += 1;

  return { score: Math.min(Math.round(score), 100), breakdown };
}

/** Alias kept for parity with the Phase 0 client API. */
export const scoreMatch = rankScore;

/** Cursor pagination helper — stable ordering for HLD §7.2 pagination. */
export function compareForCursor(
  a: { score: number; userId: string },
  b: { score: number; userId: string },
): number {
  if (a.score !== b.score) return b.score - a.score;
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
}
