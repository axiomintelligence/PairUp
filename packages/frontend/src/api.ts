import type {
  Connection,
  ConnectionRequest,
  ConnectionsResponse,
  MatchesResponse,
  ProfileBody,
  ProfileResponse,
  RequestsResponse,
  SearchPrefs,
  SessionUser,
} from './types.ts';

// ───────────────────────────────────────────────────────────────────────────
// Typed fetch wrapper. One function per API endpoint. Server is the source of
// truth for everything; the frontend caches nothing in localStorage beyond
// trivial UI flags (last active tab).
//
// CSRF: state-changing routes need an X-CSRF-Token header equal to the
// pairup_csrf cookie. The cookie is non-HttpOnly per HLD §5.3 so we can read
// it here; the session cookie stays HttpOnly + SameSite=Lax.
// ───────────────────────────────────────────────────────────────────────────

const CSRF_COOKIE = 'pairup_csrf';

function readCsrfToken(): string {
  const match = document.cookie.split('; ').find((p) => p.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : '';
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json',
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    headers['x-csrf-token'] = readCsrfToken();
  }

  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  if (res.headers.get('content-type')?.includes('application/json')) {
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const obj = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      res.status,
      obj?.code ?? `http_${res.status}`,
      obj?.message ?? res.statusText ?? 'Request failed',
    );
  }

  return payload as T;
}

// ─── Auth ──────────────────────────────────────────────────────────────────

export interface AuthMeResponse {
  authenticated: boolean;
  user: SessionUser | null;
}

export const auth = {
  me: () => request<AuthMeResponse>('GET', '/api/auth/me'),
  signOut: () => request<void>('POST', '/api/auth/logout'),
  loginUrl: (next = '/') => `/api/auth/login?next=${encodeURIComponent(next)}`,
};

// ─── Profile ──────────────────────────────────────────────────────────────

export const profile = {
  me: () => request<ProfileResponse>('GET', '/api/profile/me'),
  save: (body: ProfileBody) => request<ProfileResponse>('PUT', '/api/profile/me', body),
  publish: () => request<ProfileResponse>('POST', '/api/profile/me/publish'),
  unpublish: () => request<ProfileResponse>('POST', '/api/profile/me/unpublish'),
};

// ─── Search prefs ─────────────────────────────────────────────────────────

export const searchPrefs = {
  get: () => request<SearchPrefs>('GET', '/api/search-prefs'),
  put: (prefs: SearchPrefs) => request<SearchPrefs>('PUT', '/api/search-prefs', prefs),
};

// ─── Matches ──────────────────────────────────────────────────────────────

export const matches = {
  list: (cursor?: string) =>
    request<MatchesResponse>(
      'GET',
      cursor ? `/api/matches?cursor=${encodeURIComponent(cursor)}` : '/api/matches',
    ),
  dismiss: (id: string) => request<void>('POST', `/api/matches/${encodeURIComponent(id)}/dismiss`),
  undismiss: (id: string) =>
    request<void>('DELETE', `/api/matches/${encodeURIComponent(id)}/dismiss`),
};

// ─── Connection requests ───────────────────────────────────────────────────

export const requests = {
  list: () => request<RequestsResponse>('GET', '/api/requests'),
  create: (toUserId: string) =>
    request<ConnectionRequest>('POST', '/api/requests', { toUserId }),
  accept: (id: string) =>
    request<ConnectionRequest>('POST', `/api/requests/${encodeURIComponent(id)}/accept`),
  decline: (id: string) =>
    request<ConnectionRequest>('POST', `/api/requests/${encodeURIComponent(id)}/decline`),
  withdraw: (id: string) =>
    request<ConnectionRequest>('POST', `/api/requests/${encodeURIComponent(id)}/withdraw`),
};

export const connections = {
  list: () => request<ConnectionsResponse>('GET', '/api/connections'),
};

// ─── GDPR ─────────────────────────────────────────────────────────────────

export const me = {
  exportData: () => request<unknown>('GET', '/api/me/export'),
  deleteAccount: () => request<void>('DELETE', '/api/me'),
};

// ─── Admin ────────────────────────────────────────────────────────────────

export interface AdminStats {
  users: number;
  publishedProfiles: number;
  pendingRequests: number;
  acceptedConnections: number;
  signupsLast7Days: number;
}

export interface AdminWeights {
  gradePenalty: 'hard' | 'heavy' | 'light' | 'none';
  outboundPendingCap: number;
}

export interface AllowlistEntry {
  email: string;
  addedBy: string | null;
  addedAt: string;
  note: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorUserId: string | null;
  action: string;
  target: string | null;
}

export const admin = {
  stats: () => request<AdminStats>('GET', '/api/admin/stats'),
  getWeights: () => request<AdminWeights>('GET', '/api/admin/weights'),
  putWeights: (w: AdminWeights) => request<AdminWeights>('PUT', '/api/admin/weights', w),
  listAllowlist: (q?: string, cursor?: string) => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (cursor) qs.set('cursor', cursor);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ entries: AllowlistEntry[]; nextCursor: string | null }>(
      'GET',
      `/api/admin/allowlist${suffix}`,
    );
  },
  bulkAdd: (emails: string[], note?: string) =>
    request<{
      added: number;
      alreadyPresent: number;
      rejected: Array<{ email: string; reason: string }>;
    }>('POST', '/api/admin/allowlist/bulk-add', { emails, note }),
  bulkRemove: (emails: string[]) =>
    request<{ removed: number; notPresent: number }>(
      'POST',
      '/api/admin/allowlist/bulk-remove',
      { emails },
    ),
  removeOne: (email: string) =>
    request<void>('DELETE', `/api/admin/allowlist/${encodeURIComponent(email)}`),
  audit: (limit = 100) =>
    request<{ entries: AuditEntry[] }>('GET', `/api/admin/audit?limit=${limit}`),
};

export type { Connection, ConnectionRequest };
