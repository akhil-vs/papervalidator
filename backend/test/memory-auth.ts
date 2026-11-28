import { randomUUID } from 'node:crypto';
import { EmailAlreadyUsed, NotFound } from '../src/domain/errors.js';
import type { Teacher } from '../src/domain/teacher.js';
import type { Account, AttemptCounter, AuthRepository, AuthTokenPurpose, AuthTokenRecord } from '../src/application/auth-ports.js';
import type { MemoryTeachers } from './memory-teachers.js';

type StoredToken = AuthTokenRecord & { tokenHash: string };

export class MemoryAccounts implements AuthRepository {
  private readonly accounts = new Map<string, Account>();
  private readonly tokens: StoredToken[] = [];

  constructor(private readonly teachers: MemoryTeachers) {}

  async findByEmail(email: string): Promise<Account | null> {
    const needle = email.toLocaleLowerCase('en');
    for (const account of this.accounts.values()) {
      if (account.email.toLocaleLowerCase('en') === needle) return cloneAccount(account);
    }
    return null;
  }

  async findById(id: string): Promise<Account | null> {
    const account = this.accounts.get(id);
    return account ? cloneAccount(account) : null;
  }

  async createCoordinator(input: { schoolName: string; fullName: string; email: string; passwordHash: string }): Promise<Account> {
    if (await this.findByEmail(input.email)) throw new EmailAlreadyUsed();
    const account: Account = {
      id: randomUUID(),
      schoolId: randomUUID(),
      fullName: input.fullName,
      email: input.email,
      role: 'coordinator',
      passwordHash: input.passwordHash,
      emailVerifiedAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
    };
    this.accounts.set(account.id, account);
    this.teachers.rows.push({
      id: account.id,
      schoolId: account.schoolId,
      fullName: account.fullName,
      email: account.email,
    });
    this.teachers.roles.set(account.id, 'coordinator');
    return cloneAccount(account);
  }

  async ensureLogin(teacher: Teacher): Promise<Account> {
    const existing = await this.findById(teacher.id);
    if (existing) return existing;
    if (!teacher.email) throw new NotFound();
    const account: Account = {
      id: teacher.id,
      schoolId: teacher.schoolId,
      fullName: teacher.fullName,
      email: teacher.email.toLocaleLowerCase('en'),
      role: this.teachers.roles.get(teacher.id) ?? 'teacher',
      passwordHash: null,
      emailVerifiedAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
    };
    this.accounts.set(account.id, account);
    return cloneAccount(account);
  }

  async setPassword(teacherId: string, passwordHash: string): Promise<void> {
    const account = this.require(teacherId);
    account.passwordHash = passwordHash;
  }

  async markEmailVerified(teacherId: string, at: Date): Promise<void> {
    const account = this.require(teacherId);
    account.emailVerifiedAt ??= at;
  }

  async recordLoginFailure(teacherId: string, failedLoginCount: number, lockedUntil: Date | null): Promise<void> {
    const account = this.require(teacherId);
    account.failedLoginCount = failedLoginCount;
    account.lockedUntil = lockedUntil;
  }

  async clearLoginFailures(teacherId: string): Promise<void> {
    const account = this.require(teacherId);
    account.failedLoginCount = 0;
    account.lockedUntil = null;
  }

  async saveToken(input: {
    teacherId: string;
    purpose: AuthTokenPurpose;
    tokenHash: string;
    familyId: string | null;
    expiresAt: Date;
  }): Promise<void> {
    this.tokens.push({
      teacherId: input.teacherId,
      purpose: input.purpose,
      tokenHash: input.tokenHash,
      familyId: input.familyId,
      expiresAt: input.expiresAt,
      usedAt: null,
      revokedAt: null,
    });
  }

  async findToken(tokenHash: string, purpose: AuthTokenPurpose): Promise<AuthTokenRecord | null> {
    const token = this.tokens.find((item) => item.tokenHash === tokenHash && item.purpose === purpose);
    return token ? cloneToken(token) : null;
  }

  async consumeToken(tokenHash: string, purpose: AuthTokenPurpose, at: Date): Promise<AuthTokenRecord | null> {
    const token = this.tokens.find((item) => item.tokenHash === tokenHash && item.purpose === purpose);
    if (!token || token.usedAt || token.revokedAt || token.expiresAt.getTime() <= at.getTime()) return null;
    token.usedAt = at;
    return cloneToken(token);
  }

  async revokeToken(tokenHash: string, at: Date): Promise<void> {
    const token = this.tokens.find((item) => item.tokenHash === tokenHash);
    if (token && !token.revokedAt) token.revokedAt = at;
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    for (const token of this.tokens) {
      if (token.familyId === familyId && !token.revokedAt) token.revokedAt = at;
    }
  }

  async revokeRefreshTokens(teacherId: string, at: Date): Promise<void> {
    for (const token of this.tokens) {
      if (token.teacherId === teacherId && token.purpose === 'refresh' && !token.revokedAt) token.revokedAt = at;
    }
  }

  private require(teacherId: string): Account {
    const account = this.accounts.get(teacherId);
    if (!account) throw new NotFound();
    return account;
  }
}

export class MemoryAttempts implements AttemptCounter {
  private readonly hits: { scope: string; subject: string; at: number }[] = [];

  async count(scope: string, subject: string, since: Date): Promise<number> {
    return this.hits.filter((hit) => hit.scope === scope && hit.subject === subject && hit.at >= since.getTime()).length;
  }

  async add(scope: string, subject: string, at: Date): Promise<void> {
    this.hits.push({ scope, subject, at: at.getTime() });
  }
}

function cloneAccount(account: Account): Account {
  return {
    ...account,
    emailVerifiedAt: account.emailVerifiedAt ? new Date(account.emailVerifiedAt) : null,
    lockedUntil: account.lockedUntil ? new Date(account.lockedUntil) : null,
  };
}

function cloneToken(token: StoredToken): AuthTokenRecord {
  return {
    teacherId: token.teacherId,
    purpose: token.purpose,
    familyId: token.familyId,
    expiresAt: new Date(token.expiresAt),
    usedAt: token.usedAt ? new Date(token.usedAt) : null,
    revokedAt: token.revokedAt ? new Date(token.revokedAt) : null,
  };
}
