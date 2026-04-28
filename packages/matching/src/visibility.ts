import { DAY_GATE_THRESHOLD, DEFAULT_VISIBILITY } from './constants.js';
import { dayComplementarity, directorateOverlapAny } from './days.js';
import type { Profile, SearchPrefs, Visibility } from './types.js';

function visibilityOf(p: Profile): Visibility {
  return { ...DEFAULT_VISIBILITY, ...p.visibility };
}

/**
 * Does the candidate's own visibility settings let this searcher see them?
 * Used by the Stage-1 SQL pre-filter (HLD §7.2) to exclude candidates whose
 * "must" gates the searcher fails.
 */
export function candidateVisibleToSearcher(
  searcher: Profile,
  candidate: Profile,
): boolean {
  const v = visibilityOf(candidate);
  if (v.grade === 'must' && candidate.grade !== searcher.grade) return false;
  if (v.directorates === 'must' && !directorateOverlapAny(searcher.directorates, candidate.directorates))
    return false;
  if (v.location === 'must' && candidate.location !== searcher.location) return false;
  if (v.days === 'must' && dayComplementarity(searcher.days, candidate.days) < DAY_GATE_THRESHOLD)
    return false;
  return true;
}

/**
 * Symmetric check: would the user's own visibility rules let this candidate
 * find them? Used to flag one-way visibility on match cards.
 */
export function userVisibleToCandidate(user: Profile, candidate: Profile): boolean {
  const v = visibilityOf(user);
  if (v.grade === 'must' && candidate.grade !== user.grade) return false;
  if (v.directorates === 'must' && !directorateOverlapAny(user.directorates, candidate.directorates))
    return false;
  if (v.location === 'must' && candidate.location !== user.location) return false;
  if (v.days === 'must' && dayComplementarity(user.days, candidate.days) < DAY_GATE_THRESHOLD)
    return false;
  return true;
}

/**
 * Apply the searcher's own search-prefs `definite` gates. A "definite" pref
 * acts as a hard filter on candidates.
 */
export function candidateSatisfiesSearcherGates(
  searcher: Profile,
  candidate: Profile,
  prefs: SearchPrefs,
): boolean {
  if (prefs.grade === 'definite' && candidate.grade !== searcher.grade) return false;
  if (prefs.directorates === 'definite' && !directorateOverlapAny(searcher.directorates, candidate.directorates))
    return false;
  if (prefs.location === 'definite' && candidate.location !== searcher.location) return false;
  if (prefs.days === 'definite' && dayComplementarity(searcher.days, candidate.days) < DAY_GATE_THRESHOLD)
    return false;
  return true;
}
