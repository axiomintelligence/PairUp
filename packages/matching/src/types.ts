// Shared types for matching. Pure data; no runtime dependencies.

export type DayMode = 'full' | 'part' | 'non' | 'flexible';
export type DayKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
export type Days = Record<DayKey, DayMode>;

export type Grade = 'AA/AO' | 'EO' | 'HEO' | 'SEO' | 'G7' | 'G6' | 'SCS1' | 'SCS2';

export type DaysNegotiable = 'yes' | 'possibly' | 'no';

export type VisibilityMode = 'must' | 'open';
export interface Visibility {
  grade: VisibilityMode;
  directorates: VisibilityMode;
  location: VisibilityMode;
  days: VisibilityMode;
}

export type SearchPref = 'definite' | 'preferred' | 'irrelevant';
export interface SearchPrefs {
  grade: SearchPref;
  directorates: SearchPref;
  location: SearchPref;
  days: SearchPref;
}

export type GradePenalty = 'hard' | 'heavy' | 'light' | 'none';
export interface MatchWeights {
  gradePenalty: GradePenalty;
}

// Subset of HLD §6 `profiles` columns needed for scoring + visibility gates.
export interface Profile {
  grade: Grade;
  directorates: string[];
  location: string;
  days: Days;
  visibility: Visibility;
  daysNegotiable?: DaysNegotiable;
  // null when never seen (synthetic data import) — counted as fully stale.
  lastActiveAt: Date | null;
}

export interface ScoreBreakdownEntry {
  label: string;
  score: number;
  max: number;
  note: string;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdownEntry[];
}
