import type {
  DayKey,
  Days,
  Grade,
  MatchWeights,
  SearchPrefs,
  Visibility,
} from './types.js';

export const DAYS_OF_WEEK: readonly DayKey[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export const GRADES: readonly Grade[] = [
  'AA/AO',
  'EO',
  'HEO',
  'SEO',
  'G7',
  'G6',
  'SCS1',
  'SCS2',
];

export const GRADE_INDEX: Readonly<Record<Grade, number>> = Object.fromEntries(
  GRADES.map((g, i) => [g, i] as const),
) as Record<Grade, number>;

// Day-pair scoring table — symmetric pairs encoded twice for O(1) lookup.
// Lifted unchanged from apps/web-static/app.js (Phase 0); behaviour parity is
// covered by the test suite.
export const DAY_PAIR_SCORES: Readonly<Record<string, number>> = {
  'full+non': 1.0,
  'non+full': 1.0,
  'full+flexible': 0.8,
  'flexible+full': 0.8,
  'part+non': 0.6,
  'non+part': 0.6,
  'part+flexible': 0.5,
  'flexible+part': 0.5,
  'flexible+flexible': 0.4,
  'part+part': 0.3,
  'non+non': 0.2,
  'full+full': 0.0,
  'full+part': 0.1,
  'part+full': 0.1,
  'non+flexible': 0.3,
  'flexible+non': 0.3,
};

export const EMPTY_DAYS: Days = {
  Mon: 'non',
  Tue: 'non',
  Wed: 'non',
  Thu: 'non',
  Fri: 'non',
};

export const DEFAULT_VISIBILITY: Visibility = {
  grade: 'must',
  directorates: 'must',
  location: 'open',
  days: 'open',
};

export const DEFAULT_SEARCH_PREFS: SearchPrefs = {
  grade: 'definite',
  directorates: 'definite',
  location: 'preferred',
  days: 'preferred',
};

export const DEFAULT_WEIGHTS: MatchWeights = {
  gradePenalty: 'heavy',
};

export const OPEN_TO_ANY = 'Open to any';

// When a side has visibility set to "must" on a dimension, this is the floor
// the other side must clear for that dimension to count as compatible.
export const DAY_GATE_THRESHOLD = 0.3;
