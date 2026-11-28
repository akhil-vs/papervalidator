import type { Role } from '../domain/role.js';
import type { Teacher } from '../domain/teacher.js';

export type Account = {
  id: string;
  schoolId: string;
  fullName: string;
  email: string;
  role: Role;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
};

export type AuthTokenPurpose = 'refresh' | 'email_verification' | 'password_reset';

export type AuthTokenRecord = {
  teacherId: string;
  purpose: AuthTokenPurpose;
  familyId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
};

export interface AuthRepository {
  findByEmail(email: string): Promise<Account | null>;
  findById(id: string): Promise<Account | null>;
  createCoordinator(input: { schoolName: string; fullName: string; email: string; passwordHash: string }): Promise<Account>;
  ensureLogin(teacher: Teacher): Promise<Account>;
  setPassword(teacherId: string, passwordHash: string): Promise<void>;
  markEmailVerified(teacherId: string, at: Date): Promise<void>;
  recordLoginFailure(teacherId: string, failedLoginCount: number, lockedUntil: Date | null): Promise<void>;
  clearLoginFailures(teacherId: string): Promise<void>;
  saveToken(input: {
    teacherId: string;
    purpose: AuthTokenPurpose;
    tokenHash: string;
    familyId: string | null;
    expiresAt: Date;
  }): Promise<void>;
  findToken(tokenHash: string, purpose: AuthTokenPurpose): Promise<AuthTokenRecord | null>;
  consumeToken(tokenHash: string, purpose: AuthTokenPurpose, at: Date): Promise<AuthTokenRecord | null>;
  revokeToken(tokenHash: string, at: Date): Promise<void>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revokeRefreshTokens(teacherId: string, at: Date): Promise<void>;
}

export interface AttemptCounter {
  count(scope: string, subject: string, since: Date): Promise<number>;
  add(scope: string, subject: string, at: Date): Promise<void>;
}

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, passwordHash: string): Promise<boolean>;
}
