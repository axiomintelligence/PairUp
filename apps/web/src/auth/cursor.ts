// Opaque cursor for HLD §7.2 keyset pagination on (score desc, user_id asc).

export interface MatchCursor {
  score: number;
  userId: string;
}

export function encodeCursor(cursor: MatchCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(value: string | undefined): MatchCursor | null {
  if (!value) return null;
  try {
    const obj = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as MatchCursor;
    if (
      typeof obj.score !== 'number' ||
      typeof obj.userId !== 'string' ||
      obj.score < 0 ||
      obj.score > 100
    ) {
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}
