import type { Pool } from 'pg';
import {
  candidateSatisfiesSearcherGates,
  candidateVisibleToSearcher,
  type Days,
  type Grade,
  type Profile,
  type SearchPrefs,
  type Visibility,
} from '@pairup/matching';
import { getPool } from './pool.js';

// ───────────────────────────────────────────────────────────────────────────
// HLD §7.2 Stage 1 — SQL pre-filter on `profiles`.
//
// Coarse, index-friendly filters (status='published', not self, not dismissed,
// directorate overlap, location/grade exact-match where the searcher has a
// "definite" pref). Fine-grained day complementarity gates run in node post-
// fetch via the @pairup/matching helpers because day complementarity is a
// 5-dimensional matrix lookup that doesn't pre-filter usefully in SQL.
//
// Indexes used (created in PR 4):
//   • (status, grade)            — common path for grade-gated searches
//   • GIN (directorates)         — array overlap
//   • partial (user_id) WHERE status='published' — reduces matching pool size
// ───────────────────────────────────────────────────────────────────────────

const STAGE_1_HARD_LIMIT = 500;

export interface CandidateRow {
  user_id: string;
  display_name: string;
  email: string;
  last_seen_at: Date;
  status: 'draft' | 'published';
  grade: string;
  directorates: string[];
  location: string;
  fte: string | null;
  days_negotiable: string | null;
  availability: string | null;
  skills: string | null;
  working_pattern_notes: string | null;
  other_info: string | null;
  style: string | null;
  days: Days;
  visibility: Visibility;
  published_at: Date | null;
  updated_at: Date;
}

export interface SearcherProfile extends Profile {
  userId: string;
}

interface FetchOptions {
  searcher: SearcherProfile;
  prefs: SearchPrefs;
  limit?: number;
}

export async function fetchCandidatePool(opts: FetchOptions): Promise<CandidateRow[]> {
  const pool = getPool();
  const limit = Math.min(opts.limit ?? STAGE_1_HARD_LIMIT, STAGE_1_HARD_LIMIT);

  const sql = `
    SELECT
      p.user_id, p.status, p.grade, p.directorates, p.location, p.fte,
      p.days_negotiable, p.availability, p.skills, p.working_pattern_notes,
      p.other_info, p.style, p.days, p.visibility, p.published_at, p.updated_at,
      u.display_name, u.email, u.last_seen_at
    FROM profiles p
    JOIN users u ON u.id = p.user_id
    WHERE p.status = 'published'
      AND p.user_id <> $1
      AND p.user_id NOT IN (SELECT dismissed_user_id FROM dismissals WHERE user_id = $1)
      -- Candidate's "must" visibility gates that map cleanly to SQL:
      AND (p.visibility->>'grade' <> 'must' OR p.grade = $2)
      AND (p.visibility->>'directorates' <> 'must'
           OR p.directorates && $3
           OR 'Open to any' = ANY(p.directorates)
           OR 'Open to any' = ANY($3))
      AND (p.visibility->>'location' <> 'must' OR p.location = $4)
      -- Searcher's own "definite" gates:
      AND ($5 <> 'definite' OR p.grade = $2)
      AND ($6 <> 'definite'
           OR p.directorates && $3
           OR 'Open to any' = ANY(p.directorates)
           OR 'Open to any' = ANY($3))
      AND ($7 <> 'definite' OR p.location = $4)
    LIMIT $8
  `;
  const params: unknown[] = [
    opts.searcher.userId,
    opts.searcher.grade,
    opts.searcher.directorates,
    opts.searcher.location,
    opts.prefs.grade,
    opts.prefs.directorates,
    opts.prefs.location,
    limit,
  ];
  const { rows } = await pool.query<CandidateRow>(sql, params);
  return rows;
}

/** Convert a CandidateRow into the Profile shape @pairup/matching expects. */
export function rowToProfile(row: CandidateRow): Profile {
  return {
    grade: row.grade as Grade,
    directorates: row.directorates,
    location: row.location,
    days: row.days,
    visibility: row.visibility,
    daysNegotiable: row.days_negotiable as Profile['daysNegotiable'],
    lastActiveAt: row.last_seen_at,
  };
}

/**
 * Apply the day-gate filters that don't translate to SQL. Returns the rows
 * that satisfy:
 *   - candidate's `visibility.days = 'must'` against searcher's days, AND
 *   - searcher's `prefs.days = 'definite'` against candidate's days.
 */
export function applyDayGates(
  rows: CandidateRow[],
  searcher: Profile,
  prefs: SearchPrefs,
): CandidateRow[] {
  return rows.filter((row) => {
    const candidate = rowToProfile(row);
    if (!candidateVisibleToSearcher(searcher, candidate)) return false;
    if (!candidateSatisfiesSearcherGates(searcher, candidate, prefs)) return false;
    return true;
  });
}

export async function loadSearcher(pool: Pool, userId: string): Promise<SearcherProfile | null> {
  const { rows } = await pool.query<{
    user_id: string;
    grade: string;
    directorates: string[];
    location: string;
    days: Days;
    visibility: Visibility;
    days_negotiable: string | null;
    last_seen_at: Date;
  }>(
    `SELECT p.user_id, p.grade, p.directorates, p.location, p.days, p.visibility,
            p.days_negotiable, u.last_seen_at
     FROM profiles p
     JOIN users u ON u.id = p.user_id
     WHERE p.user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    grade: row.grade as Grade,
    directorates: row.directorates,
    location: row.location,
    days: row.days,
    visibility: row.visibility,
    daysNegotiable: row.days_negotiable as Profile['daysNegotiable'],
    lastActiveAt: row.last_seen_at,
  };
}
