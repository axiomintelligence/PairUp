import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getPool } from '../db/pool.js';
import { writeAudit } from '../db/audit.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { Errors } from '../errors.js';

// ─── Schemas ────────────────────────────────────────────────────────────────

const Day = z.enum(['full', 'part', 'non', 'flexible']);
const DaysSchema = z.object({
  Mon: Day,
  Tue: Day,
  Wed: Day,
  Thu: Day,
  Fri: Day,
});

const Visibility = z.enum(['must', 'open']);
const VisibilitySchema = z.object({
  grade: Visibility,
  directorates: Visibility,
  location: Visibility,
  days: Visibility,
});

const PROFILE_GRADES = [
  'AA/AO',
  'EO',
  'HEO',
  'SEO',
  'G7',
  'G6',
  'SCS1',
  'SCS2',
] as const;

const ProfileBodySchema = z.object({
  grade: z.enum(PROFILE_GRADES),
  directorates: z.array(z.string().min(1)).max(20),
  location: z.string().min(1).max(120),
  overseasPost: z.string().max(120).nullish(),
  fte: z.string().max(40).nullish(),
  daysNegotiable: z.enum(['yes', 'possibly', 'no']).nullish(),
  availability: z.string().max(2000).nullish(),
  skills: z.string().max(2000).nullish(),
  workingPatternNotes: z.string().max(2000).nullish(),
  otherInfo: z.string().max(2000).nullish(),
  style: z.string().max(40).nullish(),
  days: DaysSchema,
  visibility: VisibilitySchema,
});

type ProfileBody = z.infer<typeof ProfileBodySchema>;

const ProfileResponseSchema = ProfileBodySchema.extend({
  status: z.enum(['draft', 'published']),
  publishedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});

// ─── DB row mapping ─────────────────────────────────────────────────────────

interface ProfileRow {
  user_id: string;
  status: 'draft' | 'published';
  grade: string;
  directorates: string[];
  location: string;
  overseas_post: string | null;
  fte: string | null;
  days_negotiable: string | null;
  availability: string | null;
  skills: string | null;
  working_pattern_notes: string | null;
  other_info: string | null;
  style: string | null;
  days: Record<string, string>;
  visibility: Record<string, string>;
  published_at: Date | null;
  updated_at: Date;
}

function rowToResponse(row: ProfileRow): z.infer<typeof ProfileResponseSchema> {
  return {
    grade: row.grade as ProfileBody['grade'],
    directorates: row.directorates,
    location: row.location,
    overseasPost: row.overseas_post,
    fte: row.fte,
    daysNegotiable: row.days_negotiable as ProfileBody['daysNegotiable'],
    availability: row.availability,
    skills: row.skills,
    workingPatternNotes: row.working_pattern_notes,
    otherInfo: row.other_info,
    style: row.style,
    days: row.days as ProfileBody['days'],
    visibility: row.visibility as ProfileBody['visibility'],
    status: row.status,
    publishedAt: row.published_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
  };
}

// ─── Validation: required fields for publish ────────────────────────────────

function isPublishable(body: ProfileBody): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (!body.grade) missing.push('grade');
  if (body.directorates.length === 0) missing.push('directorates');
  if (!body.location) missing.push('location');
  // At least one day must be 'full', 'part', or 'flexible' — i.e. not all 'non'.
  const anyWorking = (Object.values(body.days) as string[]).some((d) => d !== 'non');
  if (!anyWorking) missing.push('days');
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// ─── Routes ────────────────────────────────────────────────────────────────

export async function registerProfileRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/api/profile/me',
    schema: {
      tags: ['profile'],
      summary: 'Returns the session user’s profile (404 if no draft yet).',
      response: { 200: ProfileResponseSchema },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req) => {
      const userId = req.session!.user.id;
      const pool = getPool();
      const { rows } = await pool.query<ProfileRow>('SELECT * FROM profiles WHERE user_id = $1', [
        userId,
      ]);
      const row = rows[0];
      if (!row) throw Errors.notFound('Profile not yet created');
      return rowToResponse(row);
    },
  });

  r.route({
    method: 'PUT',
    url: '/api/profile/me',
    preHandler: [verifyCsrf],
    schema: {
      tags: ['profile'],
      summary: 'Upsert the session user’s profile (always saves as draft).',
      body: ProfileBodySchema,
      response: { 200: ProfileResponseSchema },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req) => {
      const userId = req.session!.user.id;
      const body = req.body as ProfileBody;
      const pool = getPool();

      const sql = `
        INSERT INTO profiles (
          user_id, status, grade, directorates, location, overseas_post, fte,
          days_negotiable, availability, skills, working_pattern_notes,
          other_info, style, days, visibility, updated_at
        )
        VALUES ($1, 'draft', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
        ON CONFLICT (user_id) DO UPDATE SET
          grade                  = EXCLUDED.grade,
          directorates           = EXCLUDED.directorates,
          location               = EXCLUDED.location,
          overseas_post          = EXCLUDED.overseas_post,
          fte                    = EXCLUDED.fte,
          days_negotiable        = EXCLUDED.days_negotiable,
          availability           = EXCLUDED.availability,
          skills                 = EXCLUDED.skills,
          working_pattern_notes  = EXCLUDED.working_pattern_notes,
          other_info             = EXCLUDED.other_info,
          style                  = EXCLUDED.style,
          days                   = EXCLUDED.days,
          visibility             = EXCLUDED.visibility,
          updated_at             = now()
        RETURNING *
      `;
      const params = [
        userId,
        body.grade,
        body.directorates,
        body.location,
        body.overseasPost ?? null,
        body.fte ?? null,
        body.daysNegotiable ?? null,
        body.availability ?? null,
        body.skills ?? null,
        body.workingPatternNotes ?? null,
        body.otherInfo ?? null,
        body.style ?? null,
        JSON.stringify(body.days),
        JSON.stringify(body.visibility),
      ];
      const { rows } = await pool.query<ProfileRow>(sql, params);
      const row = rows[0];
      if (!row) throw new Error('profile upsert returned no rows');

      await writeAudit({
        actorUserId: userId,
        action: 'profile.update',
        target: userId,
      });
      return rowToResponse(row);
    },
    config: {
      // PR 7 wires real rate limits; HLD §7.1 caps PUT /profile/me at 120/hour/user.
      rateLimit: { max: 120, timeWindow: '1 hour' },
    },
  });

  r.route({
    method: 'POST',
    url: '/api/profile/me/publish',
    preHandler: [verifyCsrf],
    schema: {
      tags: ['profile'],
      summary: 'Mark the user’s draft profile as published (enters the matching pool).',
      response: { 200: ProfileResponseSchema },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req) => {
      const userId = req.session!.user.id;
      const pool = getPool();

      const { rows: existingRows } = await pool.query<ProfileRow>(
        'SELECT * FROM profiles WHERE user_id = $1',
        [userId],
      );
      const existing = existingRows[0];
      if (!existing) throw Errors.notFound('Create your profile before publishing');

      const body: ProfileBody = {
        grade: existing.grade as ProfileBody['grade'],
        directorates: existing.directorates,
        location: existing.location,
        overseasPost: existing.overseas_post,
        fte: existing.fte,
        daysNegotiable: existing.days_negotiable as ProfileBody['daysNegotiable'],
        availability: existing.availability,
        skills: existing.skills,
        workingPatternNotes: existing.working_pattern_notes,
        otherInfo: existing.other_info,
        style: existing.style,
        days: existing.days as ProfileBody['days'],
        visibility: existing.visibility as ProfileBody['visibility'],
      };
      const check = isPublishable(body);
      if (!check.ok) {
        throw Errors.profileIncomplete(`Missing required fields: ${check.missing.join(', ')}`);
      }

      const { rows } = await pool.query<ProfileRow>(
        `UPDATE profiles
         SET status = 'published',
             published_at = COALESCE(published_at, now()),
             updated_at  = now()
         WHERE user_id = $1
         RETURNING *`,
        [userId],
      );
      await writeAudit({
        actorUserId: userId,
        action: 'profile.publish',
        target: userId,
      });
      return rowToResponse(rows[0]!);
    },
  });

  r.route({
    method: 'POST',
    url: '/api/profile/me/unpublish',
    preHandler: [verifyCsrf],
    schema: {
      tags: ['profile'],
      summary: 'Revert profile to draft — removes from matching pool.',
      response: { 200: ProfileResponseSchema },
      security: [{ sessionCookie: [] }],
    },
    handler: async (req) => {
      const userId = req.session!.user.id;
      const pool = getPool();
      const { rows } = await pool.query<ProfileRow>(
        `UPDATE profiles
         SET status = 'draft',
             updated_at = now()
         WHERE user_id = $1
         RETURNING *`,
        [userId],
      );
      const row = rows[0];
      if (!row) throw Errors.notFound('No profile to unpublish');
      await writeAudit({
        actorUserId: userId,
        action: 'profile.unpublish',
        target: userId,
      });
      return rowToResponse(row);
    },
  });
}
