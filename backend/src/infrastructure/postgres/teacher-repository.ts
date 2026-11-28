import pg from 'pg';
import { AccessDenied, EmailAlreadyUsed } from '../../domain/errors.js';
import type { Teacher, TeacherPage } from '../../domain/teacher.js';
import type { TeacherRepository } from '../../application/ports.js';

type TeacherRow = {
  id: string;
  school_id: string;
  full_name: string;
  email: string | null;
};

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 5 });
}

export function createTeacherRepository(pool: pg.Pool): TeacherRepository {
  return {
    async findInSchool(schoolId, teacherId) {
      const result = await pool.query<TeacherRow>(
        `SELECT id, school_id, full_name, email
         FROM teachers
         WHERE school_id = $1 AND id = $2`,
        [schoolId, teacherId]
      );
      const row = result.rows[0];
      return row ? mapTeacher(row) : null;
    },

    async roleInSchool(schoolId, teacherId) {
      const result = await pool.query<{ role: string }>(`SELECT role FROM teachers WHERE school_id = $1 AND id = $2`, [
        schoolId,
        teacherId,
      ]);
      const role = result.rows[0]?.role;
      if (role === 'coordinator' || role === 'teacher') return role;
      return null;
    },

    async list(query) {
      const pattern = query.nameQuery === null ? null : likeContains(query.nameQuery);
      const filters = `school_id = $1 AND ($2::text IS NULL OR full_name ILIKE $2 ESCAPE '\\')`;
      const params: unknown[] = [query.schoolId, pattern];
      const count = await pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM teachers WHERE ${filters}`, params);
      const column = query.sort === 'email' ? 'email' : 'full_name';
      const direction = query.direction === 'desc' ? 'DESC' : 'ASC';
      const nulls = query.direction === 'desc' ? 'NULLS FIRST' : 'NULLS LAST';
      const rows = await pool.query<TeacherRow>(
        `SELECT id, school_id, full_name, email
         FROM teachers
         WHERE ${filters}
         ORDER BY ${column} ${direction} ${nulls}, id ASC
         LIMIT $3 OFFSET $4`,
        [...params, query.limit, query.offset]
      );
      const page: TeacherPage = {
        data: rows.rows.map(mapTeacher),
        page: {
          limit: query.limit,
          offset: query.offset,
          total: Number(count.rows[0]?.total ?? 0),
        },
      };
      return page;
    },

    async insert(input) {
      try {
        const result = await pool.query<TeacherRow>(
          `INSERT INTO teachers (school_id, full_name, email)
           VALUES ($1, $2, $3)
           RETURNING id, school_id, full_name, email`,
          [input.schoolId, input.fullName, input.email]
        );
        const row = result.rows[0];
        if (!row) throw new Error('Insert returned no teacher.');
        return mapTeacher(row);
      } catch (error) {
        if (pgCode(error) === '23505') throw new EmailAlreadyUsed();
        if (pgCode(error) === '23503') throw new AccessDenied();
        throw error;
      }
    },
  };
}

function mapTeacher(row: TeacherRow): Teacher {
  return {
    id: row.id,
    schoolId: row.school_id,
    fullName: row.full_name,
    email: row.email,
  };
}

function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function pgCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}
