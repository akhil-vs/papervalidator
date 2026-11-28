import pg from 'pg';
import { EmailAlreadyUsed, NotFound } from '../../domain/errors.js';
import type { Role } from '../../domain/role.js';
import type { Account, AuthRepository, AuthTokenPurpose, AuthTokenRecord } from '../../application/auth-ports.js';

type AccountRow = {
  id: string;
  school_id: string;
  full_name: string;
  email: string;
  role: string;
  password_hash: string | null;
  email_verified_at: Date | null;
  failed_login_count: number;
  locked_until: Date | null;
};

type TokenRow = {
  teacher_id: string;
  purpose: AuthTokenPurpose;
  family_id: string | null;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
};

const ACCOUNT_COLUMNS = `id, school_id, full_name, email, role, password_hash, email_verified_at, failed_login_count, locked_until`;

export function createAuthRepository(pool: pg.Pool): AuthRepository {
  return {
    async findByEmail(email) {
      const result = await pool.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM teachers WHERE lower(email) = $1`, [email]);
      return mapAccount(result.rows[0]);
    },

    async findById(id) {
      const result = await pool.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM teachers WHERE id = $1`, [id]);
      return mapAccount(result.rows[0]);
    },

    async createCoordinator(input) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const school = await client.query<{ id: string }>(`INSERT INTO schools (name) VALUES ($1) RETURNING id`, [input.schoolName]);
        const schoolId = school.rows[0]?.id;
        if (!schoolId) throw new Error('Insert returned no school.');
        const teacher = await client.query<AccountRow>(
          `INSERT INTO teachers (school_id, full_name, email, role, password_hash)
           VALUES ($1, $2, $3, 'coordinator', $4)
           RETURNING ${ACCOUNT_COLUMNS}`,
          [schoolId, input.fullName, input.email, input.passwordHash]
        );
        await client.query('COMMIT');
        const account = mapAccount(teacher.rows[0]);
        if (!account) throw new Error('Insert returned no teacher.');
        return account;
      } catch (error) {
        await client.query('ROLLBACK');
        if (pgCode(error) === '23505') throw new EmailAlreadyUsed();
        throw error;
      } finally {
        client.release();
      }
    },

    async ensureLogin(teacher) {
      const existing = await this.findById(teacher.id);
      if (!existing) throw new NotFound();
      return existing;
    },

    async setPassword(teacherId, passwordHash) {
      await pool.query(`UPDATE teachers SET password_hash = $2 WHERE id = $1`, [teacherId, passwordHash]);
    },

    async markEmailVerified(teacherId, at) {
      await pool.query(`UPDATE teachers SET email_verified_at = $2 WHERE id = $1 AND email_verified_at IS NULL`, [teacherId, at]);
    },

    async recordLoginFailure(teacherId, failedLoginCount, lockedUntil) {
      await pool.query(`UPDATE teachers SET failed_login_count = $2, locked_until = $3 WHERE id = $1`, [
        teacherId,
        failedLoginCount,
        lockedUntil,
      ]);
    },

    async clearLoginFailures(teacherId) {
      await pool.query(`UPDATE teachers SET failed_login_count = 0, locked_until = NULL WHERE id = $1`, [teacherId]);
    },

    async saveToken(input) {
      await pool.query(
        `INSERT INTO auth_tokens (teacher_id, purpose, token_hash, family_id, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.teacherId, input.purpose, input.tokenHash, input.familyId, input.expiresAt]
      );
    },

    async findToken(tokenHash, purpose) {
      const result = await pool.query<TokenRow>(
        `SELECT teacher_id, purpose, family_id, expires_at, used_at, revoked_at
         FROM auth_tokens
         WHERE token_hash = $1 AND purpose = $2`,
        [tokenHash, purpose]
      );
      return mapToken(result.rows[0]);
    },

    async consumeToken(tokenHash, purpose, at) {
      const result = await pool.query<TokenRow>(
        `UPDATE auth_tokens
         SET used_at = $3
         WHERE token_hash = $1
           AND purpose = $2
           AND used_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > $3
         RETURNING teacher_id, purpose, family_id, expires_at, used_at, revoked_at`,
        [tokenHash, purpose, at]
      );
      return mapToken(result.rows[0]);
    },

    async revokeToken(tokenHash, at) {
      await pool.query(`UPDATE auth_tokens SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL`, [tokenHash, at]);
    },

    async revokeFamily(familyId, at) {
      await pool.query(`UPDATE auth_tokens SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL`, [familyId, at]);
    },

    async revokeRefreshTokens(teacherId, at) {
      await pool.query(
        `UPDATE auth_tokens
         SET revoked_at = $2
         WHERE teacher_id = $1 AND purpose = 'refresh' AND revoked_at IS NULL`,
        [teacherId, at]
      );
    },
  };
}

export function createAttemptCounter(pool: pg.Pool) {
  return {
    async count(scope: string, subject: string, since: Date) {
      const result = await pool.query<{ total: number }>(
        `SELECT count(*)::int AS total
         FROM auth_attempts
         WHERE scope = $1 AND subject = $2 AND created_at >= $3`,
        [scope, subject, since]
      );
      return Number(result.rows[0]?.total ?? 0);
    },

    async add(scope: string, subject: string, at: Date) {
      const cutoff = new Date(at.getTime() - 2 * 24 * 60 * 60 * 1000);
      await pool.query(`DELETE FROM auth_attempts WHERE scope = $1 AND subject = $2 AND created_at < $3`, [scope, subject, cutoff]);
      await pool.query(`INSERT INTO auth_attempts (scope, subject, created_at) VALUES ($1, $2, $3)`, [scope, subject, at]);
    },
  };
}

function mapAccount(row: AccountRow | undefined): Account | null {
  if (!row || !row.email) return null;
  const role: Role | null = row.role === 'coordinator' || row.role === 'teacher' ? row.role : null;
  if (!role) return null;
  return {
    id: row.id,
    schoolId: row.school_id,
    fullName: row.full_name,
    email: row.email,
    role,
    passwordHash: row.password_hash,
    emailVerifiedAt: row.email_verified_at,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
  };
}

function mapToken(row: TokenRow | undefined): AuthTokenRecord | null {
  if (!row) return null;
  return {
    teacherId: row.teacher_id,
    purpose: row.purpose,
    familyId: row.family_id,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
  };
}

function pgCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}
