// Stable error envelope per HLD §7.
//
// Every failed request returns `{ error: { code, message } }` with a code from
// the union below. The codes are part of the API contract; do not rename them
// without bumping /api/v2.

export type ErrorCode =
  | 'not_authenticated'
  | 'not_in_beta'
  | 'forbidden'
  | 'profile_incomplete'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'validation_error'
  | 'internal_error';

export interface ApiError {
  code: ErrorCode;
  message: string;
}

export class ApiException extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiException';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const Errors = {
  notAuthenticated: () =>
    new ApiException(401, 'not_authenticated', 'Authentication required'),
  notInBeta: () =>
    new ApiException(403, 'not_in_beta', 'Your account is not in the access allowlist'),
  forbidden: (message = 'Forbidden') =>
    new ApiException(403, 'forbidden', message),
  notFound: (message = 'Not found') =>
    new ApiException(404, 'not_found', message),
  conflict: (message: string) => new ApiException(409, 'conflict', message),
  profileIncomplete: (message = 'Profile is missing required fields') =>
    new ApiException(409, 'profile_incomplete', message),
  rateLimited: (message = 'Rate limit exceeded') =>
    new ApiException(429, 'rate_limited', message),
};
