import type { ListTeachersQuery, Principal, Teacher, TeacherPage } from '../domain/teacher.js';

export interface TeacherRepository {
  findInSchool(schoolId: string, teacherId: string): Promise<Teacher | null>;
  list(query: ListTeachersQuery): Promise<TeacherPage>;
  insert(input: { schoolId: string; fullName: string; email: string | null }): Promise<Teacher>;
}

export interface TokenVerifier {
  verify(token: string): Principal | null;
}

export interface TokenIssuer {
  issue(principal: Principal, ttlSeconds?: number): string;
}

export interface Logger {
  info(event: string, fields: Record<string, unknown>): void;
  error(event: string, fields: Record<string, unknown>): void;
}
