import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { JwtTokenService } from '../src/infrastructure/jwt/jwt-token-service.js';

const SECRET = 'test-secret-test-secret-test-secret';
const teacherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('a signed token verifies as the same teacher and school', () => {
  const clock = new Date('2026-11-27T12:00:00Z');
  const tokens = new JwtTokenService(SECRET, () => clock);
  const token = tokens.issue({ teacherId, schoolId }, 60);
  assert.deepEqual(tokens.verify(token), { teacherId, schoolId });
});

test('verification rejects a bad signature, the wrong secret, expiry, and alg none', () => {
  const clock = new Date('2026-11-27T12:00:00Z');
  const tokens = new JwtTokenService(SECRET, () => clock);
  const token = tokens.issue({ teacherId, schoolId }, 60);
  const [header, payload, signature] = token.split('.');
  assert.equal(tokens.verify(`${header}.${payload}.${signature}x`), null);
  assert.equal(new JwtTokenService(`${SECRET}-other`, () => clock).verify(token), null);

  const later = new JwtTokenService(SECRET, () => new Date(clock.getTime() + 120_000));
  assert.equal(later.verify(token), null);

  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const nonePayload = Buffer.from(JSON.stringify({ sub: teacherId, school_id: schoolId, exp: 9_999_999_999 })).toString('base64url');
  assert.equal(tokens.verify(`${noneHeader}.${nonePayload}.`), null);
});

test('verification rejects a token without a teacher id or school id', () => {
  const tokens = new JwtTokenService(SECRET);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: teacherId, exp: 9_999_999_999 })).toString('base64url');
  const signature = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  assert.equal(tokens.verify(`${header}.${payload}.${signature}`), null);
});

test('the signer refuses a short secret', () => {
  assert.throws(() => new JwtTokenService('too-short'), /JWT_SECRET/);
});
