import assert from 'node:assert/strict';
import test from 'node:test';
import { TeacherService } from '../src/application/teacher-service.js';
import { AccessDenied, EmailAlreadyUsed, NotFound, ValidationFailed } from '../src/domain/errors.js';
import type { Principal } from '../src/domain/teacher.js';
import { MemoryTeachers } from './memory-teachers.js';

const schoolA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const schoolB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const callerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function fixture(): { service: TeacherService; repo: MemoryTeachers; caller: Principal } {
  const repo = new MemoryTeachers();
  repo.rows.push(
    { id: callerId, schoolId: schoolA, fullName: 'Anita Shah', email: 'anita.shah@riverside.example' },
    { id: otherId, schoolId: schoolB, fullName: 'Other School', email: 'other@example.com' }
  );
  repo.roles.set(callerId, 'coordinator');
  return { service: new TeacherService(repo), repo, caller: { teacherId: callerId, schoolId: schoolA, role: 'coordinator' } };
}

test('current teacher is the row named by the token', async () => {
  const { service, caller } = fixture();
  const teacher = await service.current(caller);
  assert.equal(teacher.fullName, 'Anita Shah');
  assert.equal(teacher.email, 'anita.shah@riverside.example');
});

test('a token whose teacher is not in the school is rejected', async () => {
  const { service } = fixture();
  await assert.rejects(
    () => service.current({ teacherId: callerId, schoolId: schoolB }),
    (error: unknown) => error instanceof AccessDenied
  );
});

test('get hides teachers from another school', async () => {
  const { service, caller } = fixture();
  const own = await service.get(caller, callerId);
  assert.equal(own.id, callerId);
  await assert.rejects(
    () => service.get(caller, otherId),
    (error: unknown) => error instanceof NotFound
  );
  await assert.rejects(
    () => service.get(caller, 'not-a-uuid'),
    (error: unknown) => error instanceof NotFound
  );
});

test("create stores a trimmed teacher in the caller's school", async () => {
  const { service, caller } = fixture();
  const created = await service.create(caller, { fullName: '  Meera Nair  ', email: ' Meera.Nair@riverside.example ' });
  assert.equal(created.schoolId, schoolA);
  assert.equal(created.fullName, 'Meera Nair');
  assert.equal(created.email, 'Meera.Nair@riverside.example');
  const listed = await service.list(caller, { q: 'meera' });
  assert.equal(listed.page.total, 1);
  assert.equal(listed.data[0]?.id, created.id);
});

test('create accepts a missing or null email and rejects a duplicate ignoring case', async () => {
  const { service, caller } = fixture();
  const first = await service.create(caller, { fullName: 'No Email' });
  assert.equal(first.email, null);
  const second = await service.create(caller, { fullName: 'Also None', email: null });
  assert.equal(second.email, null);
  await assert.rejects(
    () => service.create(caller, { fullName: 'Copy', email: 'ANITA.SHAH@riverside.example' }),
    (error: unknown) => error instanceof EmailAlreadyUsed
  );
});

test('create rejects a body that is not the teacher schema', async () => {
  const { service, caller } = fixture();
  await assert.rejects(
    () => service.create(caller, { fullName: '   ', email: 'not-an-email', schoolId: schoolB }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationFailed);
      assert.deepEqual(
        error.fieldErrors.map((field) => field.pointer),
        ['/schoolId', '/fullName', '/email']
      );
      return true;
    }
  );
});

test('list pages one school and rejects an unknown query', async () => {
  const { service, caller, repo } = fixture();
  repo.rows.push(
    { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', schoolId: schoolA, fullName: 'Zara Khan', email: null },
    { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', schoolId: schoolA, fullName: 'Bea Cole', email: 'bea@riverside.example' }
  );
  const page = await service.list(caller, { limit: '1', offset: '0', sort: 'fullName' });
  assert.equal(page.page.total, 3);
  assert.equal(page.data.length, 1);
  assert.equal(page.data[0]?.fullName, 'Anita Shah');
  const last = await service.list(caller, { limit: '1', offset: '2', sort: '-fullName' });
  assert.equal(last.data[0]?.fullName, 'Anita Shah');
  await assert.rejects(
    () => service.list(caller, { page: '2' }),
    (error: unknown) => error instanceof ValidationFailed
  );
  await assert.rejects(
    () => service.list(caller, { sort: 'createdAt' }),
    (error: unknown) => error instanceof ValidationFailed
  );
  await assert.rejects(
    () => service.list(caller, { limit: '0' }),
    (error: unknown) => error instanceof ValidationFailed
  );
});

test('a teacher cannot list or add colleagues', async () => {
  const { service, repo, caller } = fixture();
  repo.roles.set(callerId, 'teacher');
  const colleague = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  repo.rows.push({ id: colleague, schoolId: schoolA, fullName: 'Bea Cole', email: null });
  await assert.rejects(
    () => service.list(caller, {}),
    (error: unknown) => error instanceof AccessDenied
  );
  await assert.rejects(
    () => service.create(caller, { fullName: 'New Teacher' }),
    (error: unknown) => error instanceof AccessDenied
  );
  const self = await service.get({ ...caller, role: 'teacher' }, callerId);
  assert.equal(self.id, callerId);
  await assert.rejects(
    () => service.get(caller, colleague),
    (error: unknown) => error instanceof AccessDenied
  );
});
