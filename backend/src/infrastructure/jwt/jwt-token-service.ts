import { createHmac, timingSafeEqual } from 'node:crypto';
import { isUuid } from '../../domain/ids.js';
import type { Principal } from '../../domain/teacher.js';
import type { TokenIssuer, TokenVerifier } from '../../application/ports.js';

const SKEW_SECONDS = 5;
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

type JwtClaims = {
  sub?: unknown;
  school_id?: unknown;
  exp?: unknown;
};

export class JwtTokenService implements TokenVerifier, TokenIssuer {
  constructor(private readonly secret: string, private readonly now: () => Date = () => new Date()) {
    if (secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters.');
    }
  }

  issue(principal: Principal, ttlSeconds = DEFAULT_TTL_SECONDS): string {
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64Url(
      JSON.stringify({
        sub: principal.teacherId,
        school_id: principal.schoolId,
        iat: issuedAt,
        exp: issuedAt + ttlSeconds,
      })
    );
    const signature = sign(`${header}.${payload}`, this.secret);
    return `${header}.${payload}.${signature}`;
  }

  verify(token: string): Principal | null {
    if (token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, signaturePart] = parts;
    if (!headerPart || !payloadPart || !signaturePart) return null;

    let header: { alg?: unknown };
    try {
      header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as { alg?: unknown };
    } catch {
      return null;
    }
    if (header.alg !== 'HS256') return null;

    const expected = Buffer.from(sign(`${headerPart}.${payloadPart}`, this.secret), 'base64url');
    const actual = Buffer.from(signaturePart, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

    let claims: JwtClaims;
    try {
      claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as JwtClaims;
    } catch {
      return null;
    }
    if (typeof claims.sub !== 'string' || !isUuid(claims.sub)) return null;
    if (typeof claims.school_id !== 'string' || !isUuid(claims.school_id)) return null;
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null;
    const now = Math.floor(this.now().getTime() / 1000);
    if (claims.exp + SKEW_SECONDS <= now) return null;
    return { teacherId: claims.sub, schoolId: claims.school_id };
  }
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}
