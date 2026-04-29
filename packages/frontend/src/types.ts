// Frontend-side types — mirror the API responses from @pairup/web. Keep these
// aligned with apps/web/src/routes/* zod schemas.

export type DayMode = 'full' | 'part' | 'non' | 'flexible';
export type DayKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
export type Days = Record<DayKey, DayMode>;

export type Grade = 'AA/AO' | 'EO' | 'HEO' | 'SEO' | 'G7' | 'G6' | 'SCS1' | 'SCS2';

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

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface ProfileBody {
  grade: Grade;
  directorates: string[];
  location: string;
  overseasPost?: string | null;
  fte?: string | null;
  daysNegotiable?: 'yes' | 'possibly' | 'no' | null;
  availability?: string | null;
  skills?: string | null;
  workingPatternNotes?: string | null;
  otherInfo?: string | null;
  style?: string | null;
  days: Days;
  visibility: Visibility;
}

export interface ProfileResponse extends ProfileBody {
  status: 'draft' | 'published';
  publishedAt: string | null;
  updatedAt: string;
}

export interface ScoreBreakdownEntry {
  label: string;
  score: number;
  max: number;
  note: string;
}

export interface MatchEntry {
  userId: string;
  displayName: string;
  grade: string;
  directorates: string[];
  location: string;
  fte: string | null;
  daysNegotiable: string | null;
  availability: string | null;
  skills: string | null;
  style: string | null;
  days: Record<string, string>;
  lastSeenAt: string;
  score: number;
  breakdown: ScoreBreakdownEntry[];
}

export interface MatchesResponse {
  matches: MatchEntry[];
  nextCursor: string | null;
}

export interface ConnectionRequest {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  createdAt: string;
  resolvedAt: string | null;
}

export interface RequestsResponse {
  inbound: ConnectionRequest[];
  outbound: ConnectionRequest[];
}

export interface Connection {
  id: string;
  otherUserId: string;
  otherDisplayName: string;
  createdAt: string;
}

export interface ConnectionsResponse {
  connections: Connection[];
}

export interface ApiError {
  error: { code: string; message: string };
}

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

export const FCDO_DIRECTORATES = [
  'Economic & Trade',
  'Climate & Environment',
  'Security & Defence',
  'Consular',
  'HR & People',
  'Communications',
  'Finance',
  'Digital & Data',
  'Programme Delivery',
  'Legal & Governance',
  'Corporate Services',
  'Overseas Network',
  'Open to any',
] as const;

export const LOCATIONS = ['London – KCS', 'East Kilbride', 'Remote', 'Overseas'] as const;
