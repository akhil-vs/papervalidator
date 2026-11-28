import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthService } from '../src/application/auth-service.js';
import type { Mailer } from '../src/application/auth-ports.js';
import { JwtTokenService } from '../src/infrastructure/jwt/jwt-token-service.js';
import { createAttemptCounter, createAuthRepository } from '../src/infrastructure/postgres/auth-repository.js';
import { createPool } from '../src/infrastructure/postgres/teacher-repository.js';
import { ensureAuthSchema } from '../src/infrastructure/schema/auth-schema.js';

const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';

class FastHasher {
  async hash(password: string): Promise<string> {
    return `fast$${password}`;
  }

  async verify(password: string, passwordHash: string): Promise<boolean> {
    return passwordHash === `fast$${password}`;
  }
}

test('postgres auth signup, verification, refresh, and logout', { skip: databaseUrl === '' }, async () => {
  const pool = createPool(databaseUrl);
  const messages: { text: string }[] = [];
  const mailer: Mailer = {
    async send(message) {
      messages.push(message);
    },
  };
  const auth = new AuthService(
    createAuthRepository(pool),
    createAttemptCounter(pool),
    new FastHasher(),
    new JwtTokenService('test-secret-test-secret-test-secret'),
    mailer
  );
  const email = `auth.${Date.now()}@riverside.example`;
  let schoolId = '';
  try {
    await ensureAuthSchema(pool);
    const created = await auth.signup(
      { schoolName: 'Auth School', fullName: 'Ada Lovelace', email, password: 'correct-horse-1' },
      '203.0.113.10'
    );
    schoolId = created.schoolId;
    const token = /token: (\S+)/.exec(messages.at(-1)?.text ?? '')?.[1] ?? '';
    await auth.confirmEmailVerification({ token });
    const session = await auth.login({ email, password: 'correct-horse-1' }, '203.0.113.10');
    const rotated = await auth.refresh({ refreshToken: session.refreshToken });
    await auth.logout({ refreshToken: rotated.refreshToken });
    await assert.rejects(() => auth.refresh({ refreshToken: rotated.refreshToken }), /missing or invalid/);
  } finally {
    if (schoolId) {
      await pool.query('DELETE FROM teachers WHERE school_id = $1', [schoolId]);
      await pool.query('DELETE FROM schools WHERE id = $1', [schoolId]);
    }
    await pool.query('DELETE FROM auth_attempts WHERE subject = $1 OR subject = $2', [email, '203.0.113.10']).catch((error: unknown) => {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== '42P01') throw error;
    });
    await pool.end();
  }
});
