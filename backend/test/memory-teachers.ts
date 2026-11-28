import { randomUUID } from 'node:crypto';
import { EmailAlreadyUsed } from '../src/domain/errors.js';
import type { Role } from '../src/domain/role.js';
import type { ListTeachersQuery, Teacher, TeacherPage } from '../src/domain/teacher.js';
import type { TeacherRepository } from '../src/application/ports.js';

export class MemoryTeachers implements TeacherRepository {
  readonly rows: Teacher[] = [];
  readonly roles = new Map<string, Role>();
  insertError: Error | null = null;

  async findInSchool(schoolId: string, teacherId: string): Promise<Teacher | null> {
    return this.rows.find((row) => row.schoolId === schoolId && row.id === teacherId) ?? null;
  }

  async roleInSchool(schoolId: string, teacherId: string): Promise<Role | null> {
    const teacher = await this.findInSchool(schoolId, teacherId);
    if (!teacher) return null;
    return this.roles.get(teacherId) ?? 'teacher';
  }

  async list(query: ListTeachersQuery): Promise<TeacherPage> {
    const needle = query.nameQuery?.toLocaleLowerCase('en') ?? null;
    const matched = this.rows.filter((row) => {
      if (row.schoolId !== query.schoolId) return false;
      if (needle === null) return true;
      return row.fullName.toLocaleLowerCase('en').includes(needle);
    });
    matched.sort((left, right) => compareTeachers(left, right, query));
    return {
      data: matched.slice(query.offset, query.offset + query.limit),
      page: { limit: query.limit, offset: query.offset, total: matched.length },
    };
  }

  async insert(input: { schoolId: string; fullName: string; email: string | null }): Promise<Teacher> {
    if (this.insertError) throw this.insertError;
    if (input.email !== null) {
      const taken = this.rows.some(
        (row) => row.email !== null && row.email.toLocaleLowerCase('en') === input.email!.toLocaleLowerCase('en')
      );
      if (taken) throw new EmailAlreadyUsed();
    }
    const teacher: Teacher = {
      id: randomUUID(),
      schoolId: input.schoolId,
      fullName: input.fullName,
      email: input.email,
    };
    this.rows.push(teacher);
    return teacher;
  }
}

function compareTeachers(left: Teacher, right: Teacher, query: ListTeachersQuery): number {
  const leftValue = query.sort === 'email' ? left.email : left.fullName;
  const rightValue = query.sort === 'email' ? right.email : right.fullName;
  if (leftValue === null && rightValue === null) return left.id.localeCompare(right.id);
  if (leftValue === null) return query.direction === 'asc' ? 1 : -1;
  if (rightValue === null) return query.direction === 'asc' ? -1 : 1;
  const direction = query.direction === 'asc' ? 1 : -1;
  const primary = leftValue.localeCompare(rightValue, 'en', { sensitivity: 'base' }) * direction;
  if (primary !== 0) return primary;
  return left.id.localeCompare(right.id);
}
