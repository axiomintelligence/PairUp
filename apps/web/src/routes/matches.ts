import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  DEFAULT_SEARCH_PREFS,
  DEFAULT_WEIGHTS,
  rankScore,
  type SearchPrefs,
  type MatchWeights,
} from '@pairup/matching';
import {
  applyDayGates,
  fetchCandidatePool,
  loadSearcher,
  rowToProfile,
  type CandidateRow,
} from '../db/match-repo.js';
import { getPool } from '../db/pool.js';
import { writeAudit } from '../db/audit.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { Errors } from '../errors.js';
import { decodeCursor, encodeCursor } from '../auth/cursor.js';

const PAGE_SIZE = 20;

const MatchSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  grade: z.string(),
  directorates: z.array(z.string()),
  location: z.string(),
  fte: z.string().nullable(),
  daysNegotiable: z.string().nullable(),
  availability: z.string().nullable(),
  skills: z.string().nullable(),
  style: z.string().nullable(),
  days: z.record(z.string()),
  lastSeenAt: z.string().datetime(),
  score: z.number().int().min(0).max(100),
  breakdown: z.array(
    z.object({
      label: z.string(),
      score: z.number().int(),
      max: z.number().int(),
      note: z.string(),
    }),
  ),
});

const MatchesResponse = z.object({
  matches: z.array(MatchSchema),
  nextCursor: z.string().nullable(),
});

const MatchesQuery = z.object({
  cursor: z.string().optional(),
});

const DismissParams = z.object({
  id: z.string().uuid(),
});

function rowToMatch(
  row: CandidateRow,
  scored: { score: number; breakdown: ReturnType<typeof rankScore>['breakdown'] },
) {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    grade: row.grade,
    directorates: row.directorates,
    location: row.location,
    fte: row.fte,
    daysNegotiable: row.days_negotiable,
    availability: row.availability,
    skills: row.skills,
    style: row.style,
    days: row.days as Record<string, string>,
    lastSeenAt: row.last_seen_at.toISOString(),
    score: scored.score,
    breakdown: scored.breakdown,
  };
}

async function loadSearchPrefs(userId: string): Promise<SearchPrefs> {
  const pool = getPool();
  const { rows } = await pool.query<{
    grade: SearchPrefs['grade'];
    directorates: SearchPrefs['directorates'];
    location: SearchPrefs['location'];
    days: SearchPrefs['days'];
  }>('SELECT grade, directorates, location, days FROM search_prefs WHERE user_id = $1', [userId]);
  return rows[0] ?? DEFAULT_SEARCH_PREFS;
}

async function loadWeights(): Promise<MatchWeights> {
  const pool = getPool();
  const { rows } = await pool.query<{ grade_penalty: MatchWeights['gradePenalty'] }>(
    'SELECT grade_penalty FROM admin_config WHERE id = 1',
  );
  return rows[0]
    ? { gradePenalty: rows[0].grade_penalty }
    : DEFAULT_WEIGHTS;
}

export async function registerMatchesRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/api/matches',
    schema: {
      tags: ['matching'],
      summary:
        'HLD §7.2 two-stage matching: SQL pre-filter → in-process scoring → ' +
        'cursor pagination on (score desc, user_id asc).',
      querystring: MatchesQuery,
      response: { 200: MatchesResponse },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req) => {
      const userId = req.session!.user.id;
      const pool = getPool();
      const searcher = await loadSearcher(pool, userId);
      if (!searcher) throw Errors.notFound('Publish your profile to see matches');

      const prefs = await loadSearchPrefs(userId);
      const weights = await loadWeights();

      const stage1 = await fetchCandidatePool({ searcher, prefs });
      const gated = applyDayGates(stage1, searcher, prefs);

      const scored = gated
        .map((row) => ({ row, scored: rankScore(searcher, rowToProfile(row), { prefs, weights }) }))
        .sort((a, b) => {
          if (a.scored.score !== b.scored.score) return b.scored.score - a.scored.score;
          return a.row.user_id < b.row.user_id ? -1 : 1;
        });

      const { cursor: cursorParam } = req.query as z.infer<typeof MatchesQuery>;
      const cursor = decodeCursor(cursorParam);
      const after = cursor
        ? scored.findIndex(
            (m) =>
              m.scored.score < cursor.score ||
              (m.scored.score === cursor.score && m.row.user_id > cursor.userId),
          )
        : 0;
      const start = after === -1 ? scored.length : after;
      const slice = scored.slice(start, start + PAGE_SIZE);
      const last = slice[slice.length - 1];
      const nextCursor =
        last && start + PAGE_SIZE < scored.length
          ? encodeCursor({ score: last.scored.score, userId: last.row.user_id })
          : null;

      return {
        matches: slice.map((m) => rowToMatch(m.row, m.scored)),
        nextCursor,
      };
    },
  });

  r.route({
    method: 'POST',
    url: '/api/matches/:id/dismiss',
    preHandler: [verifyCsrf],
    schema: {
      tags: ['matching'],
      summary: 'Hide a candidate from the matches list (idempotent).',
      params: DismissParams,
      response: { 204: z.null() },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req, reply) => {
      const userId = req.session!.user.id;
      const { id } = req.params as z.infer<typeof DismissParams>;
      if (id === userId) throw Errors.conflict('Cannot dismiss yourself');
      const pool = getPool();
      await pool.query(
        `INSERT INTO dismissals (user_id, dismissed_user_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, dismissed_user_id) DO NOTHING`,
        [userId, id],
      );
      await writeAudit({
        actorUserId: userId,
        action: 'dismissal.created',
        target: id,
      });
      reply.code(204).send();
    },
  });

  r.route({
    method: 'DELETE',
    url: '/api/matches/:id/dismiss',
    preHandler: [verifyCsrf],
    schema: {
      tags: ['matching'],
      summary: 'Un-dismiss a candidate (idempotent).',
      params: DismissParams,
      response: { 204: z.null() },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req, reply) => {
      const userId = req.session!.user.id;
      const { id } = req.params as z.infer<typeof DismissParams>;
      const pool = getPool();
      await pool.query(
        'DELETE FROM dismissals WHERE user_id = $1 AND dismissed_user_id = $2',
        [userId, id],
      );
      await writeAudit({
        actorUserId: userId,
        action: 'dismissal.removed',
        target: id,
      });
      reply.code(204).send();
    },
  });
}
