import assert from 'node:assert/strict';
import test from 'node:test';
import type { Server } from 'node:http';
import { TeacherService } from '../src/application/teacher-service.js';
import type { Logger } from '../src/application/ports.js';
import type { Principal } from '../src/domain/teacher.js';
import { JwtTokenService } from '../src/infrastructure/jwt/jwt-token-service.js';
import { createLogger } from '../src/infrastructure/logging/logger.js';
import { createHttpServer } from '../src/interfaces/http/server.js';
import { MemoryTeachers } from './memory-teachers.js';

const SECRET = 'test-secret-test-secret-test-secret';
const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const teacherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('health is public and teacher routes require a bearer token', async () => {
  await withServer(new MemoryTeachers(), async (base) => {
    const health = await fetch(`${base}/v1/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const missing = await fetch(`${base}/v1/me`);
    assert.equal(missing.status, 401);
    assert.equal(missing.headers.get('content-type'), 'application/problem+json; charset=utf-8');
    const body = (await missing.json()) as { detail?: string; type?: string };
    assert.equal(body.detail, 'Bearer token is missing or invalid.');
    assert.equal(body.type, 'https://api.exampapervalidator.example/problems/unauthorized');

    const basic = await fetch(`${base}/v1/teachers`, { headers: { authorization: 'Basic abc' } });
    assert.equal(basic.status, 401);
  });
});

test('the caller can read their profile, add a teacher, and receive its location', async () => {
  const repo = new MemoryTeachers();
  repo.rows.push({ id: teacherId, schoolId, fullName: 'Anita Shah', email: 'anita.shah@riverside.example' });
  repo.roles.set(teacherId, 'coordinator');
  await withServer(repo, async (base, issue) => {
    const authorization = `Bearer ${issue({ teacherId, schoolId, role: 'coordinator' })}`;
    const me = await fetch(`${base}/v1/me`, { headers: { authorization } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), {
      id: teacherId,
      schoolId,
      fullName: 'Anita Shah',
      email: 'anita.shah@riverside.example',
    });

    const created = await fetch(`${base}/v1/teachers`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Rohan Das', email: 'rohan.das@riverside.example' }),
    });
    assert.equal(created.status, 201);
    const teacher = (await created.json()) as { id: string; schoolId: string };
    assert.equal(teacher.schoolId, schoolId);
    assert.equal(created.headers.get('location'), `${base}/v1/teachers/${teacher.id}`);

    const fetched = await fetch(`${base}/v1/teachers/${teacher.id}`, { headers: { authorization } });
    assert.equal(fetched.status, 200);

    const duplicate = await fetch(`${base}/v1/teachers`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Again', email: 'Rohan.Das@riverside.example' }),
    });
    assert.equal(duplicate.status, 409);
    const conflict = (await duplicate.json()) as { type?: string };
    assert.equal(conflict.type, 'https://api.exampapervalidator.example/problems/conflict');
  });
});

test('a deleted account and a server failure stay out of the response body', async () => {
  const repo = new MemoryTeachers();
  const logged: Record<string, unknown>[] = [];
  const logger: Logger = {
    info() {},
    error(_event, fields) {
      logged.push(fields);
    },
  };
  await withServer(
    repo,
    async (base, issue) => {
      const authorization = `Bearer ${issue({ teacherId, schoolId, role: 'coordinator' })}`;
      const denied = await fetch(`${base}/v1/me`, { headers: { authorization } });
      assert.equal(denied.status, 403);

      repo.rows.push({ id: teacherId, schoolId, fullName: 'Anita Shah', email: null });
      repo.roles.set(teacherId, 'coordinator');
      repo.insertError = new Error('relation teachers has a secret constraint');
      const failed = await fetch(`${base}/v1/teachers`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: 'New Teacher' }),
      });
      assert.equal(failed.status, 500);
      const body = await failed.text();
      assert.equal(body.includes('secret constraint'), false);
      assert.equal(body.includes('Something went wrong.'), true);
      assert.equal(JSON.stringify(logged).includes('secret constraint'), true);
    },
    logger
  );
});

test('logs keep the path and drop credential fields', () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    createLogger().info('http.request', { authorization: 'Bearer secret-value', token: 'abc', path: '/v1/me' });
  } finally {
    console.log = original;
  }
  const line = lines[0] ?? '';
  assert.equal(line.includes('secret-value'), false);
  assert.equal(line.includes('abc'), false);
  assert.equal(line.includes('/v1/me'), true);
});

test('unknown routes and the wrong method are problem documents', async () => {
  const repo = new MemoryTeachers();
  repo.rows.push({ id: teacherId, schoolId, fullName: 'Anita Shah', email: null });
  await withServer(repo, async (base, issue) => {
    const authorization = `Bearer ${issue({ teacherId, schoolId, role: 'teacher' })}`;
    const missing = await fetch(`${base}/v1/students`, { headers: { authorization } });
    assert.equal(missing.status, 404);
    const wrongMethod = await fetch(`${base}/v1/me`, { method: 'DELETE', headers: { authorization } });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET');
  });
});

async function withServer(
  repo: MemoryTeachers,
  fn: (base: string, issue: (principal: Principal) => string) => Promise<void>,
  logger: Logger = { info() {}, error() {} }
): Promise<void> {
  const tokens = new JwtTokenService(SECRET);
  const server = createHttpServer({
    teachers: new TeacherService(repo),
    tokens,
    logger,
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port.');
  try {
    await fn(`http://127.0.0.1:${address.port}`, (principal) => tokens.issue(principal));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
}
