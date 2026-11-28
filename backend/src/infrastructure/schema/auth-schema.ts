import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export async function ensureAuthSchema(pool: pg.Pool): Promise<void> {
  const sql = readFileSync(authMigrationPath(), 'utf8');
  for (const statement of splitSql(sql)) {
    await pool.query(statement);
  }
}

export function authMigrationPath(): string {
  const candidates = [
    new URL('../../../../db/migrations/003_auth.sql', import.meta.url),
    new URL('../../../db/migrations/003_auth.sql', import.meta.url),
  ];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (existsSync(path)) return path;
  }
  throw new Error('Auth migration was not found.');
}

export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let dollar: string | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index] ?? '';
    if (dollar) {
      if (sql.startsWith(dollar, index)) {
        current += dollar;
        index += dollar.length - 1;
        dollar = null;
        continue;
      }
      current += character;
      continue;
    }
    if (character === '$') {
      const marker = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(index));
      if (marker) {
        dollar = marker[0];
        current += dollar;
        index += dollar.length - 1;
        continue;
      }
    }
    if (character === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      continue;
    }
    current += character;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}
