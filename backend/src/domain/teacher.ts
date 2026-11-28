import type { Role } from './role.js';

export type Teacher = {
  id: string;
  schoolId: string;
  fullName: string;
  email: string | null;
};

export type Principal = {
  teacherId: string;
  schoolId: string;
  role: Role;
};

export type TeacherSort = 'fullName' | 'email';
export type SortDirection = 'asc' | 'desc';

export type ListTeachersQuery = {
  schoolId: string;
  limit: number;
  offset: number;
  sort: TeacherSort;
  direction: SortDirection;
  nameQuery: string | null;
};

export type TeacherPage = {
  data: Teacher[];
  page: {
    limit: number;
    offset: number;
    total: number;
  };
};

export function toTeacherJson(teacher: Teacher): {
  id: string;
  schoolId: string;
  fullName: string;
  email: string | null;
} {
  return {
    id: teacher.id,
    schoolId: teacher.schoolId,
    fullName: teacher.fullName,
    email: teacher.email,
  };
}
