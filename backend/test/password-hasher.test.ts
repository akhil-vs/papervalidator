import assert from 'node:assert/strict';
import test from 'node:test';
import { ScryptHasher } from '../src/infrastructure/crypto/password-hasher.js';
import { splitSql, authMigrationPath } from '../src/infrastructure/schema/auth-schema.js';
import { readFileSync } from 'node:fs';

test('scrypt stores a salted hash and rejects the wrong password', async () => {
  const hasher = new ScryptHasher({ N: 1024, r: 8, p: 1 });
  const hash = await hasher.hash('correct-horse-1');
  assert.equal(hash.startsWith('scrypt$1024$8$1$'), true);
  assert.equal(await hasher.verify('correct-horse-1', hash), true);
  assert.equal(await hasher.verify('correct-horse-2', hash), false);
  assert.equal(await new ScryptHasher().verify('correct-horse-1', hash), true);
  assert.equal(await hasher.verify('correct-horse-1', 'scrypt$1024$8$1$aaaa$bbbb'), false);
});

test('the auth migration stays one statement across the role check', () => {
  const statements = splitSql(readFileSync(authMigrationPath(), 'utf8'));
  assert.equal(statements.length, 10);
  assert.equal(
    statements.some((statement) => statement.includes('teachers_role_check') && statement.includes('END')),
    true
  );
});
