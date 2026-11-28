export type Role = 'coordinator' | 'teacher';

export function isRole(value: unknown): value is Role {
  return value === 'coordinator' || value === 'teacher';
}
