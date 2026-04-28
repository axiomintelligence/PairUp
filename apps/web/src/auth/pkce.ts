import { createHash, randomBytes } from 'node:crypto';

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

export function codeChallengeS256(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier).digest());
}

export function generateRandomState(): string {
  return base64UrlEncode(randomBytes(16));
}

export function generateNonce(): string {
  return base64UrlEncode(randomBytes(16));
}
