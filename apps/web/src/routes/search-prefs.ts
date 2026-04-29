import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getPool } from '../db/pool.js';
import { writeAudit } from '../db/audit.js';
import { verifyCsrf } from '../middleware/csrf.js';

const Pref = z.enum(['definite', 'preferred', 'irrelevant']);

const SearchPrefsSchema = z.object({
  grade: Pref,
  directorates: Pref,
  location: Pref,
  days: Pref,
});

type PrefValue = 'definite' | 'preferred' | 'irrelevant';

interface SearchPrefsRow {
  grade: string;
  directorates: string;
  location: string;
  days: string;
}

function rowToResponse(row: SearchPrefsRow): {
  grade: PrefValue;
  directorates: PrefValue;
  location: PrefValue;
  days: PrefValue;
} {
  return {
    grade: row.grade as PrefValue,
    directorates: row.directorates as PrefValue,
    location: row.location as PrefValue,
    days: row.days as PrefValue,
  };
}

export async function registerSearchPrefsRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/api/search-prefs',
    schema: {
      tags: ['matching'],
      summary: 'Returns the searcher’s per-dimension search prefs (defaults if no row).',
      response: { 200: SearchPrefsSchema },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req) => {
      const userId = req.session!.user.id;
      const pool = getPool();
      const { rows } = await pool.query<SearchPrefsRow>(
        'SELECT grade, directorates, location, days FROM search_prefs WHERE user_id = $1',
        [userId],
      );
      // search_prefs CHECK defaults match HLD §6 & migrations PR 4.
      return rows[0]
        ? rowToResponse(rows[0])
        : ({
            grade: 'definite',
            directorates: 'definite',
            location: 'preferred',
            days: 'preferred',
          } satisfies {
            grade: PrefValue;
            directorates: PrefValue;
            location: PrefValue;
            days: PrefValue;
          });
    },
  });

  r.route({
    method: 'PUT',
    url: '/api/search-prefs',
    preHandler: [verifyCsrf],
    schema: {
      tags: ['matching'],
      summary: 'Upsert the searcher’s per-dimension search prefs.',
      body: SearchPrefsSchema,
      response: { 200: SearchPrefsSchema },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req) => {
      const userId = req.session!.user.id;
      const body = req.body as z.infer<typeof SearchPrefsSchema>;
      const pool = getPool();
      const sql = `
        INSERT INTO search_prefs (user_id, grade, directorates, location, days, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (user_id) DO UPDATE
          SET grade = EXCLUDED.grade,
              directorates = EXCLUDED.directorates,
              location = EXCLUDED.location,
              days = EXCLUDED.days,
              updated_at = now()
        RETURNING grade, directorates, location, days
      `;
      const { rows } = await pool.query<SearchPrefsRow>(sql, [
        userId,
        body.grade,
        body.directorates,
        body.location,
        body.days,
      ]);
      await writeAudit({ actorUserId: userId, action: 'profile.update', target: 'search_prefs' });
      return rowToResponse(rows[0]!);
    },
  });
}
