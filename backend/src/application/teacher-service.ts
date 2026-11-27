import { AccessDenied, NotFound, ValidationFailed } from '../domain/errors.js';
import { isUuid } from '../domain/ids.js';
import type { FieldError } from '../domain/errors.js';
import type { ListTeachersQuery, Principal, Teacher, TeacherPage, TeacherSort, SortDirection } from '../domain/teacher.js';
import type { TeacherRepository } from './ports.js';

const QUERY_KEYS = new Set(['limit', 'offset', 'sort', 'q']);
const EMAIL =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export class TeacherService {
  constructor(private readonly teachers: TeacherRepository) {}

  async current(principal: Principal): Promise<Teacher> {
    return this.requireMember(principal);
  }

  async get(principal: Principal, teacherId: string): Promise<Teacher> {
    await this.requireMember(principal);
    if (!isUuid(teacherId)) throw new NotFound();
    const teacher = await this.teachers.findInSchool(principal.schoolId, teacherId);
    if (!teacher) throw new NotFound();
    return teacher;
  }

  async list(principal: Principal, rawQuery: Record<string, string>): Promise<TeacherPage> {
    await this.requireMember(principal);
    const query = parseListQuery(principal.schoolId, rawQuery);
    return this.teachers.list(query);
  }

  async create(principal: Principal, body: unknown): Promise<Teacher> {
    await this.requireMember(principal);
    const input = parseCreate(body);
    return this.teachers.insert({
      schoolId: principal.schoolId,
      fullName: input.fullName,
      email: input.email,
    });
  }

  private async requireMember(principal: Principal): Promise<Teacher> {
    const teacher = await this.teachers.findInSchool(principal.schoolId, principal.teacherId);
    if (!teacher) throw new AccessDenied();
    return teacher;
  }
}

function parseListQuery(schoolId: string, rawQuery: Record<string, string>): ListTeachersQuery {
  const errors: FieldError[] = [];
  for (const key of Object.keys(rawQuery)) {
    if (!QUERY_KEYS.has(key)) {
      errors.push({ pointer: `/${key}`, detail: 'Unknown query parameter.' });
    }
  }
  if (errors.length > 0) throw new ValidationFailed(errors);

  return {
    schoolId,
    limit: integerParam(rawQuery.limit, 50, 1, 100, '/limit'),
    offset: integerParam(rawQuery.offset, 0, 0, 1_000_000_000, '/offset'),
    ...parseSort(rawQuery.sort),
    nameQuery: parseNameQuery(rawQuery.q),
  };
}

function integerParam(value: string | undefined, fallback: number, min: number, max: number, pointer: string): number {
  if (value === undefined) return fallback;
  if (!/^[0-9]+$/.test(value)) {
    throw new ValidationFailed([{ pointer, detail: 'Must be an integer.' }]);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ValidationFailed([{ pointer, detail: `Must be between ${min} and ${max}.` }]);
  }
  return parsed;
}

function parseSort(value: string | undefined): { sort: TeacherSort; direction: SortDirection } {
  if (value === undefined) return { sort: 'fullName', direction: 'asc' };
  const descending = value.startsWith('-');
  const field = descending ? value.slice(1) : value;
  if (field !== 'fullName' && field !== 'email') {
    throw new ValidationFailed([{ pointer: '/sort', detail: 'Sort field is not allowed.' }]);
  }
  return { sort: field, direction: descending ? 'desc' : 'asc' };
}

function parseNameQuery(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (value.length < 1 || value.length > 200) {
    throw new ValidationFailed([{ pointer: '/q', detail: 'Must be between 1 and 200 characters.' }]);
  }
  return value;
}

function parseCreate(body: unknown): { fullName: string; email: string | null } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationFailed([{ detail: 'Request body must be an object.' }]);
  }
  const record = body as Record<string, unknown>;
  const errors: FieldError[] = [];
  for (const key of Object.keys(record)) {
    if (key !== 'fullName' && key !== 'email') {
      errors.push({ pointer: `/${key}`, detail: 'Unknown field.' });
    }
  }

  let fullName = '';
  if (typeof record.fullName !== 'string') {
    errors.push({ pointer: '/fullName', detail: 'Name is required.' });
  } else {
    fullName = record.fullName.trim();
    if (fullName.length < 1 || fullName.length > 200) {
      errors.push({ pointer: '/fullName', detail: 'Name must be between 1 and 200 characters.' });
    } else if (/[\u0000-\u001f\u007f]/.test(fullName)) {
      errors.push({ pointer: '/fullName', detail: 'Name cannot include control characters.' });
    }
  }

  let email: string | null = null;
  if ('email' in record && record.email !== null) {
    if (typeof record.email !== 'string') {
      errors.push({ pointer: '/email', detail: 'Email must be a string or null.' });
    } else {
      const trimmed = record.email.trim();
      if (!isEmail(trimmed)) {
        errors.push({ pointer: '/email', detail: 'Email is invalid.' });
      } else {
        email = trimmed;
      }
    }
  }

  if (errors.length > 0) throw new ValidationFailed(errors);
  return { fullName, email };
}

function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}
