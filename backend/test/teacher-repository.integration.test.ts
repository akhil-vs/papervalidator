import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { TeacherService } from '../src/application/teacher-service.js';
import { EmailAlreadyUsed } from '../src/domain/errors.js';
import { createPool, createTeacherRepository } from '../src/infrastructure/postgres/teacher-repository.js';
import { ensureAuthSchema } from '../src/infrastructure/schema/auth-schema.js';

const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';

test('postgres repository keeps teachers inside one school', { skip: databaseUrl === '' }, async () => {
  const pool = createPool(databaseUrl);
  const schoolId = randomUUID();
  const callerId = randomUUID();
  const email = `percent.${schoolId}@example.com`;
  try {
    await ensureAuthSchema(pool);
    await pool.query('INSERT INTO schools (id, name) VALUES ($1, $2)', [schoolId, 'Auth module test']);
    await pool.query('INSERT INTO teachers (id, school_id, full_name, role) VALUES ($1, $2, $3, $4)', [
      callerId,
      schoolId,
      'Caller',
      'coordinator',
    ]);
    const service = new TeacherService(createTeacherRepository(pool));
    const principal = { teacherId: callerId, schoolId, role: 'coordinator' as const };
    const created = await service.create(principal, { fullName: '100% Done', email });
    const matched = await service.list(principal, { q: '%' });
    assert.equal(matched.page.total, 1);
    assert.equal(matched.data[0]?.id, created.id);
    const everyone = await service.list(principal, {});
    assert.equal(everyone.page.total, 2);
    await assert.rejects(
      () => service.create(principal, { fullName: 'Copy', email: email.toUpperCase() }),
      (error: unknown) => error instanceof EmailAlreadyUsed
    );
  } finally {
    await pool.query('DELETE FROM teachers WHERE school_id = $1', [schoolId]);
    await pool.query('DELETE FROM schools WHERE id = $1', [schoolId]);
    await pool.end();
  }
});
