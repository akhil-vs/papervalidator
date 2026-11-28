import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import test from 'node:test';
import { AuthService, DEFAULT_AUTH_LIMITS, type AuthLimits } from '../src/application/auth-service.js';
import type { Mailer, PasswordHasher } from '../src/application/auth-ports.js';
import { TeacherService } from '../src/application/teacher-service.js';
import { JwtTokenService } from '../src/infrastructure/jwt/jwt-token-service.js';
import { createHttpServer } from '../src/interfaces/http/server.js';
import { MemoryAccounts, MemoryAttempts } from './memory-auth.js';
import { MemoryTeachers } from './memory-teachers.js';

const SECRET = 'test-secret-test-secret-test-secret';
const PASSWORD = 'correct-horse-1';
const NEXT_PASSWORD = 'different-horse-2';

class FastHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return `fast$${password}`;
  }

  async verify(password: string, passwordHash: string): Promise<boolean> {
    return passwordHash === `fast$${password}`;
  }
}

class CapturingMailer implements Mailer {
  readonly messages: { to: string; subject: string; text: string }[] = [];

  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    this.messages.push(message);
  }
}

type Harness = {
  base: string;
  mail: CapturingMailer;
  clock: { current: Date };
};

test('signup confirms email before login, then logout revokes the refresh token', async () => {
  await withAuth(async ({ base, mail }) => {
    const created = await post(base, '/v1/auth/signup', signupBody());
    assert.equal(created.status, 201);
    const account = (await created.json()) as { email?: string; role?: string; emailVerified?: boolean; accessToken?: string };
    assert.equal(account.email, 'anita@riverside.example');
    assert.equal(account.role, 'coordinator');
    assert.equal(account.emailVerified, false);
    assert.equal(account.accessToken, undefined);
    assert.equal(JSON.stringify(account).includes(PASSWORD), false);

    const unverified = await post(base, '/v1/auth/login', { email: 'Anita@riverside.example', password: PASSWORD });
    assert.equal(unverified.status, 403);
    assert.equal(((await unverified.json()) as { type?: string }).type, 'https://api.exampapervalidator.example/problems/email-unverified');

    const confirmed = await post(base, '/v1/auth/email-verifications/confirm', { token: tokenFrom(mail) });
    assert.equal(confirmed.status, 204);

    const loggedIn = await post(base, '/v1/auth/login', { email: 'anita@riverside.example', password: PASSWORD });
    assert.equal(loggedIn.status, 200);
    const session = (await loggedIn.json()) as { accessToken: string; refreshToken: string; expiresIn: number; tokenType: string };
    assert.equal(session.tokenType, 'Bearer');
    assert.equal(session.expiresIn, 900);
    const me = await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${session.accessToken}` } });
    assert.equal(me.status, 200);

    const wrong = await post(base, '/v1/auth/login', { email: 'anita@riverside.example', password: 'not-the-password-1' });
    assert.equal(wrong.status, 401);
    assert.equal(((await wrong.json()) as { detail?: string }).detail, 'Email or password is incorrect.');

    const loggedOut = await post(base, '/v1/auth/logout', { refreshToken: session.refreshToken });
    assert.equal(loggedOut.status, 204);
    const reused = await post(base, '/v1/auth/refresh', { refreshToken: session.refreshToken });
    assert.equal(reused.status, 401);
    const unknownLogout = await post(base, '/v1/auth/logout', { refreshToken: 'missing-token' });
    assert.equal(unknownLogout.status, 204);
  });
});

test('a reused refresh token revokes the replacement token', async () => {
  await withAuth(async ({ base, mail }) => {
    await verifyNewCoordinator(base, mail);
    const first = await session(base);
    const rotated = await post(base, '/v1/auth/refresh', { refreshToken: first.refreshToken });
    assert.equal(rotated.status, 200);
    const second = (await rotated.json()) as { refreshToken: string };
    const stolen = await post(base, '/v1/auth/refresh', { refreshToken: first.refreshToken });
    assert.equal(stolen.status, 401);
    const killed = await post(base, '/v1/auth/refresh', { refreshToken: second.refreshToken });
    assert.equal(killed.status, 401);
  });
});

test('failed logins lock the account and an address limit stops guessing', async () => {
  await withAuth(
    async ({ base, mail, clock }) => {
      await verifyNewCoordinator(base, mail);
      const first = await post(base, '/v1/auth/login', { email: 'anita@riverside.example', password: 'wrong-password-1' });
      const second = await post(base, '/v1/auth/login', { email: 'anita@riverside.example', password: 'wrong-password-2' });
      assert.equal(first.status, 401);
      assert.equal(second.status, 401);
      const locked = await post(base, '/v1/auth/login', { email: 'anita@riverside.example', password: PASSWORD });
      assert.equal(locked.status, 429);
      assert.equal(locked.headers.get('retry-after'), '60');
      clock.current = new Date(clock.current.getTime() + 61_000);
      const unlocked = await post(base, '/v1/auth/login', { email: 'anita@riverside.example', password: PASSWORD });
      assert.equal(unlocked.status, 200);
    },
    { loginFailures: 2, lockSeconds: 60 }
  );

  await withAuth(
    async ({ base }) => {
      const body = { email: 'nobody@riverside.example', password: 'wrong-password-1' };
      assert.equal((await post(base, '/v1/auth/login', body)).status, 401);
      assert.equal((await post(base, '/v1/auth/login', body)).status, 401);
      const limited = await post(base, '/v1/auth/login', body);
      assert.equal(limited.status, 429);
    },
    { loginPerIp: 2, loginFailures: 10 }
  );
});

test('password reset replaces the password and ends existing sessions', async () => {
  await withAuth(async ({ base, mail, clock }) => {
    await verifyNewCoordinator(base, mail);
    const active = await session(base);
    const before = mail.messages.length;
    const missing = await post(base, '/v1/auth/password-resets', { email: 'missing@riverside.example' });
    assert.equal(missing.status, 202);
    assert.equal(mail.messages.length, before);

    const requested = await post(base, '/v1/auth/password-resets', { email: 'Anita@riverside.example' });
    assert.equal(requested.status, 202);
    const weak = await post(base, '/v1/auth/password-resets/confirm', { token: tokenFrom(mail), password: 'short1' });
    assert.equal(weak.status, 400);
    const reset = await post(base, '/v1/auth/password-resets/confirm', { token: tokenFrom(mail), password: NEXT_PASSWORD });
    assert.equal(reset.status, 204);
    assert.equal((await post(base, '/v1/auth/refresh', { refreshToken: active.refreshToken })).status, 401);
    assert.equal((await post(base, '/v1/auth/login', { email: 'anita@riverside.example', password: PASSWORD })).status, 401);
    assert.equal((await post(base, '/v1/auth/login', { email: 'anita@riverside.example', password: NEXT_PASSWORD })).status, 200);

    const again = await post(base, '/v1/auth/password-resets', { email: 'anita@riverside.example' });
    assert.equal(again.status, 202);
    clock.current = new Date(clock.current.getTime() + 2 * 60 * 60 * 1000);
    const expired = await post(base, '/v1/auth/password-resets/confirm', { token: tokenFrom(mail), password: 'another-horse-3' });
    assert.equal(expired.status, 400);
  });
});

test('a coordinator can invite a teacher, and that teacher cannot add accounts', async () => {
  await withAuth(async ({ base, mail }) => {
    await verifyNewCoordinator(base, mail);
    const coordinator = await session(base);
    const created = await fetch(`${base}/v1/teachers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${coordinator.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Meera Nair', email: 'Meera@riverside.example' }),
    });
    assert.equal(created.status, 201);
    assert.equal(mail.messages.at(-1)?.subject, 'Set your password');
    assert.equal((await post(base, '/v1/auth/password-resets/confirm', { token: tokenFrom(mail), password: PASSWORD })).status, 204);
    const teacher = await session(base, 'meera@riverside.example');
    const denied = await fetch(`${base}/v1/teachers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${teacher.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Someone Else' }),
    });
    assert.equal(denied.status, 403);
    const me = await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${teacher.accessToken}` } });
    assert.equal(me.status, 200);
    assert.equal(((await me.json()) as { fullName?: string }).fullName, 'Meera Nair');
  });
});

test('signup rejects a weak password and a duplicate email', async () => {
  await withAuth(async ({ base }) => {
    const weak = await post(base, '/v1/auth/signup', { ...signupBody(), password: 'password' });
    assert.equal(weak.status, 400);
    assert.equal((await post(base, '/v1/auth/signup', signupBody())).status, 201);
    const duplicate = await post(base, '/v1/auth/signup', signupBody());
    assert.equal(duplicate.status, 409);
  });
});

async function withAuth(fn: (harness: Harness) => Promise<void>, overrides: Partial<AuthLimits> = {}): Promise<void> {
  const clock = { current: new Date('2026-11-28T03:00:00Z') };
  const teachers = new MemoryTeachers();
  const mail = new CapturingMailer();
  const tokens = new JwtTokenService(SECRET, () => clock.current);
  const auth = new AuthService(
    new MemoryAccounts(teachers),
    new MemoryAttempts(),
    new FastHasher(),
    tokens,
    mail,
    { ...DEFAULT_AUTH_LIMITS, ...overrides },
    () => clock.current
  );
  const server = createHttpServer({
    teachers: new TeacherService(teachers),
    tokens,
    logger: { info() {}, error() {} },
    auth,
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port.');
  try {
    await fn({ base: `http://127.0.0.1:${address.port}`, mail, clock });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function signupBody(): { schoolName: string; fullName: string; email: string; password: string } {
  return {
    schoolName: 'Riverside Secondary',
    fullName: 'Anita Shah',
    email: 'Anita@riverside.example',
    password: PASSWORD,
  };
}

async function verifyNewCoordinator(base: string, mail: CapturingMailer): Promise<void> {
  assert.equal((await post(base, '/v1/auth/signup', signupBody())).status, 201);
  assert.equal((await post(base, '/v1/auth/email-verifications/confirm', { token: tokenFrom(mail) })).status, 204);
}

async function session(base: string, email = 'anita@riverside.example'): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await post(base, '/v1/auth/login', { email, password: PASSWORD });
  assert.equal(response.status, 200);
  return (await response.json()) as { accessToken: string; refreshToken: string };
}

function tokenFrom(mail: CapturingMailer): string {
  const text = mail.messages.at(-1)?.text ?? '';
  const match = /token: (\S+)/.exec(text);
  if (!match?.[1]) throw new Error('Expected a token in the message.');
  return match[1];
}

function post(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
}
