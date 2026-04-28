import {
  DAY_PAIR_SCORES,
  DAYS_OF_WEEK,
  EMPTY_DAYS,
  OPEN_TO_ANY,
} from './constants.js';
import type { Days } from './types.js';

/**
 * Returns a 0..1 score for how complementary two day patterns are.
 * 1.0 = perfectly opposite full-time coverage; 0.0 = identical full-time
 * patterns (both work all five days, no value in pairing).
 */
export function dayComplementarity(
  userDays: Days | undefined | null,
  candDays: Days | undefined | null,
): number {
  const u = userDays ?? EMPTY_DAYS;
  const c = candDays ?? EMPTY_DAYS;
  let total = 0;
  for (const d of DAYS_OF_WEEK) {
    const key = `${u[d] ?? 'non'}+${c[d] ?? 'non'}`;
    total += DAY_PAIR_SCORES[key] ?? 0.2;
  }
  return total / DAYS_OF_WEEK.length;
}

/**
 * Returns the directorates both sides have in common.
 * "Open to any" on either side widens overlap to the other party's full
 * directorate list; on both sides it's the union.
 */
export function sharedDirectorates(
  userDirs: string[] | undefined | null,
  candDirs: string[] | undefined | null,
): string[] {
  const userList = userDirs ?? [];
  const candList = candDirs ?? [];
  const u = userList.filter((d) => d !== OPEN_TO_ANY);
  const c = candList.filter((d) => d !== OPEN_TO_ANY);
  const userOpen = userList.includes(OPEN_TO_ANY);
  const candOpen = candList.includes(OPEN_TO_ANY);
  if (candOpen && userOpen) return Array.from(new Set([...u, ...c]));
  if (candOpen) return u;
  if (userOpen) return c;
  return u.filter((d) => c.includes(d));
}

/** True if the user and candidate share at least one directorate of interest. */
export function directorateOverlapAny(
  userDirs: string[] | undefined | null,
  candDirs: string[] | undefined | null,
): boolean {
  const u = userDirs ?? [];
  const c = candDirs ?? [];
  if (u.includes(OPEN_TO_ANY) || c.includes(OPEN_TO_ANY)) return true;
  return u.some((d) => c.includes(d));
}
