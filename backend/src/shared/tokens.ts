import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from './env';

export interface AccessTokenPayload {
  sub: string; // userId
  sessionId: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: env.jwtAccessTtl as jwt.SignOptions['expiresIn'] });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
}

// Refresh tokens are opaque random strings stored hashed in Session.refreshToken —
// not JWTs — so revocation is a real DB delete/flag, not "wait for expiry".
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

export function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// API keys: shown once in full, stored only as a SHA-256 hash + a short preview for the UI list.
export function generateApiKey(): { raw: string; hash: string; preview: string } {
  const raw = `mp_${crypto.randomBytes(32).toString('hex')}`;
  const hash = sha256Hex(raw);
  const preview = `${raw.slice(0, 7)}…${raw.slice(-4)}`;
  return { raw, hash, preview };
}
