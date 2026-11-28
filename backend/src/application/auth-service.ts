import { randomBytes } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { EmailAlreadyUsed, TooManyRequests, Unauthorized, ValidationFailed, EmailUnverified } from '../domain/errors.js';
import { isEmailAddress } from '../domain/email.js';
import { passwordError } from '../domain/password.js';
import type { FieldError } from '../domain/errors.js';
import type { Teacher } from '../domain/teacher.js';
import { toTeacherJson } from '../domain/teacher.js';
import { hashSecret, newSecretToken } from '../infrastructure/crypto/secret-token.js';
import type { AttemptCounter, AuthRepository, AuthTokenPurpose, Mailer, PasswordHasher } from './auth-ports.js';
import type { TokenIssuer } from './ports.js';

export type AuthLimits = {
  accessSeconds: number;
  refreshSeconds: number;
  verificationSeconds: number;
  resetSeconds: number;
  loginFailures: number;
  lockSeconds: number;
  loginPerIp: number;
  loginWindowSeconds: number;
  signupPerIp: number;
  signupWindowSeconds: number;
  resetPerSubject: number;
  resetWindowSeconds: number;
  verificationPerSubject: number;
  verificationWindowSeconds: number;
};

export const DEFAULT_AUTH_LIMITS: AuthLimits = {
  accessSeconds: 15 * 60,
  refreshSeconds: 14 * 24 * 60 * 60,
  verificationSeconds: 24 * 60 * 60,
  resetSeconds: 60 * 60,
  loginFailures: 5,
  lockSeconds: 15 * 60,
  loginPerIp: 30,
  loginWindowSeconds: 15 * 60,
  signupPerIp: 5,
  signupWindowSeconds: 60 * 60,
  resetPerSubject: 5,
  resetWindowSeconds: 60 * 60,
  verificationPerSubject: 5,
  verificationWindowSeconds: 60 * 60,
};

export type Session = {
  tokenType: 'Bearer';
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  role: 'coordinator' | 'teacher';
  teacher: ReturnType<typeof toTeacherJson>;
};

export type SignedUp = {
  id: string;
  schoolId: string;
  fullName: string;
  email: string;
  role: 'coordinator';
  emailVerified: false;
};

const ACCEPTED = { status: 'accepted' } as const;

export class AuthService {
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly accounts: AuthRepository,
    private readonly attempts: AttemptCounter,
    private readonly passwords: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly mailer: Mailer,
    private readonly limits: AuthLimits = DEFAULT_AUTH_LIMITS,
    private readonly now: () => Date = () => new Date()
  ) {
    this.dummyHash = passwords.hash(randomBytes(32).toString('base64url'));
  }

  async signup(body: unknown, ip: string): Promise<SignedUp> {
    const input = parseSignup(body);
    await this.guard('signup', ip, this.limits.signupPerIp, this.limits.signupWindowSeconds);
    await this.attempts.add('signup', ip, this.now());
    const passwordHash = await this.passwords.hash(input.password);
    const account = await this.accounts.createCoordinator({
      schoolName: input.schoolName,
      fullName: input.fullName,
      email: input.email,
      passwordHash,
    });
    await this.issueOneTime(
      account.id,
      account.email,
      'email_verification',
      this.limits.verificationSeconds,
      'Confirm your email',
      'Confirm your email for Exam Paper Validator.'
    );
    return {
      id: account.id,
      schoolId: account.schoolId,
      fullName: account.fullName,
      email: account.email,
      role: 'coordinator',
      emailVerified: false,
    };
  }

  async login(body: unknown, ip: string): Promise<Session> {
    const input = parseCredentials(body);
    await this.guard('login-ip', ip, this.limits.loginPerIp, this.limits.loginWindowSeconds);
    await this.attempts.add('login-ip', ip, this.now());
    const account = await this.accounts.findByEmail(input.email);
    const passwordHash = account?.passwordHash ?? (await this.dummyHash);
    const matches = await this.passwords.verify(input.password, passwordHash);
    if (account?.lockedUntil && account.lockedUntil.getTime() > this.now().getTime()) {
      throw new TooManyRequests(this.limits.lockSeconds);
    }
    if (!account || !account.passwordHash || !matches) {
      if (account) await this.noteFailure(account.failedLoginCount, account.id);
      throw new Unauthorized('Email or password is incorrect.');
    }
    await this.accounts.clearLoginFailures(account.id);
    if (!account.emailVerifiedAt) throw new EmailUnverified();
    return this.issueSession(account.id, account.schoolId, account.fullName, account.email, account.role);
  }

  async logout(body: unknown): Promise<void> {
    const refreshToken = parseTokenField(body, 'refreshToken');
    if (!refreshToken) return;
    const record = await this.accounts.findToken(hashSecret(refreshToken), 'refresh');
    if (!record || record.revokedAt) return;
    await this.accounts.revokeToken(hashSecret(refreshToken), this.now());
  }

  async refresh(body: unknown): Promise<Session> {
    const refreshToken = parseTokenField(body, 'refreshToken');
    if (!refreshToken) throw new Unauthorized('Refresh token is missing or invalid.');
    const tokenHash = hashSecret(refreshToken);
    const record = await this.accounts.findToken(tokenHash, 'refresh');
    if (!record) throw new Unauthorized('Refresh token is missing or invalid.');
    if (record.revokedAt || record.usedAt) {
      if (record.familyId) await this.accounts.revokeFamily(record.familyId, this.now());
      throw new Unauthorized('Refresh token is missing or invalid.');
    }
    if (record.expiresAt.getTime() <= this.now().getTime()) {
      throw new Unauthorized('Refresh token is missing or invalid.');
    }
    const account = await this.accounts.findById(record.teacherId);
    if (!account || !account.emailVerifiedAt) throw new Unauthorized('Refresh token is missing or invalid.');
    await this.accounts.revokeToken(tokenHash, this.now());
    return this.issueSession(account.id, account.schoolId, account.fullName, account.email, account.role, record.familyId);
  }

  async requestPasswordReset(body: unknown, ip: string): Promise<typeof ACCEPTED> {
    const email = parseEmailBody(body);
    await this.guard('reset-ip', ip, this.limits.resetPerSubject, this.limits.resetWindowSeconds);
    await this.guard('reset-email', email, this.limits.resetPerSubject, this.limits.resetWindowSeconds);
    await this.attempts.add('reset-ip', ip, this.now());
    await this.attempts.add('reset-email', email, this.now());
    const account = await this.accounts.findByEmail(email);
    if (account) {
      await this.issueOneTime(
        account.id,
        account.email,
        'password_reset',
        this.limits.resetSeconds,
        'Reset your password',
        'Reset your Exam Paper Validator password.'
      );
    }
    return ACCEPTED;
  }

  async confirmPasswordReset(body: unknown): Promise<void> {
    const token = requiredToken(body);
    const password = requiredPassword(body);
    const early = passwordProblem(password);
    if (early) throw new ValidationFailed([early]);
    const tokenHash = hashSecret(token);
    const existing = await this.accounts.findToken(tokenHash, 'password_reset');
    if (!existing || existing.usedAt || existing.revokedAt || existing.expiresAt.getTime() <= this.now().getTime()) {
      throw new ValidationFailed([{ pointer: '/token', detail: 'This reset link is invalid or has expired.' }]);
    }
    const account = await this.accounts.findById(existing.teacherId);
    if (!account) throw new ValidationFailed([{ pointer: '/token', detail: 'This reset link is invalid or has expired.' }]);
    const emailPolicy = passwordError(password, account.email);
    if (emailPolicy) throw new ValidationFailed([emailPolicy]);
    const record = await this.accounts.consumeToken(tokenHash, 'password_reset', this.now());
    if (!record) throw new ValidationFailed([{ pointer: '/token', detail: 'This reset link is invalid or has expired.' }]);
    await this.accounts.setPassword(record.teacherId, await this.passwords.hash(password));
    await this.accounts.markEmailVerified(record.teacherId, this.now());
    await this.accounts.revokeRefreshTokens(record.teacherId, this.now());
  }

  async requestEmailVerification(body: unknown, ip: string): Promise<typeof ACCEPTED> {
    const email = parseEmailBody(body);
    await this.guard('verify-ip', ip, this.limits.verificationPerSubject, this.limits.verificationWindowSeconds);
    await this.guard('verify-email', email, this.limits.verificationPerSubject, this.limits.verificationWindowSeconds);
    await this.attempts.add('verify-ip', ip, this.now());
    await this.attempts.add('verify-email', email, this.now());
    const account = await this.accounts.findByEmail(email);
    if (account && !account.emailVerifiedAt) {
      await this.issueOneTime(
        account.id,
        account.email,
        'email_verification',
        this.limits.verificationSeconds,
        'Confirm your email',
        'Confirm your email for Exam Paper Validator.'
      );
    }
    return ACCEPTED;
  }

  async confirmEmailVerification(body: unknown): Promise<void> {
    const token = requiredToken(body);
    const record = await this.accounts.consumeToken(hashSecret(token), 'email_verification', this.now());
    if (!record) {
      throw new ValidationFailed([{ pointer: '/token', detail: 'This confirmation link is invalid or has expired.' }]);
    }
    await this.accounts.markEmailVerified(record.teacherId, this.now());
  }

  async sendPasswordSetup(teacher: Teacher): Promise<void> {
    if (!teacher.email) return;
    const account = (await this.accounts.findById(teacher.id)) ?? (await this.accounts.ensureLogin(teacher));
    await this.issueOneTime(
      account.id,
      account.email,
      'password_reset',
      this.limits.resetSeconds,
      'Set your password',
      'Set a password for your Exam Paper Validator account.'
    );
  }

  private async issueSession(
    teacherId: string,
    schoolId: string,
    fullName: string,
    email: string,
    role: 'coordinator' | 'teacher',
    familyId: string | null = null
  ): Promise<Session> {
    const refreshToken = newSecretToken();
    const nextFamily = familyId ?? randomUUID();
    await this.accounts.saveToken({
      teacherId,
      purpose: 'refresh',
      tokenHash: hashSecret(refreshToken),
      familyId: nextFamily,
      expiresAt: new Date(this.now().getTime() + this.limits.refreshSeconds * 1000),
    });
    return {
      tokenType: 'Bearer',
      accessToken: this.tokens.issue({ teacherId, schoolId, role }, this.limits.accessSeconds),
      refreshToken,
      expiresIn: this.limits.accessSeconds,
      role,
      teacher: toTeacherJson({ id: teacherId, schoolId, fullName, email }),
    };
  }

  private async issueOneTime(
    teacherId: string,
    email: string,
    purpose: AuthTokenPurpose,
    ttlSeconds: number,
    subject: string,
    intro: string
  ): Promise<void> {
    const token = newSecretToken();
    await this.accounts.saveToken({
      teacherId,
      purpose,
      tokenHash: hashSecret(token),
      familyId: null,
      expiresAt: new Date(this.now().getTime() + ttlSeconds * 1000),
    });
    await this.mailer.send({ to: email, subject, text: `${intro}\n\ntoken: ${token}\n` });
  }

  private async noteFailure(failedLoginCount: number, teacherId: string): Promise<void> {
    const next = failedLoginCount + 1;
    if (next >= this.limits.loginFailures) {
      await this.accounts.recordLoginFailure(teacherId, 0, new Date(this.now().getTime() + this.limits.lockSeconds * 1000));
      return;
    }
    await this.accounts.recordLoginFailure(teacherId, next, null);
  }

  private async guard(scope: string, subject: string, limit: number, windowSeconds: number): Promise<void> {
    const since = new Date(this.now().getTime() - windowSeconds * 1000);
    const count = await this.attempts.count(scope, subject, since);
    if (count >= limit) throw new TooManyRequests(windowSeconds);
  }
}

function parseSignup(body: unknown): { schoolName: string; fullName: string; email: string; password: string } {
  const record = objectBody(body);
  const errors: FieldError[] = [];
  for (const key of Object.keys(record)) {
    if (!['schoolName', 'fullName', 'email', 'password'].includes(key)) {
      errors.push({ pointer: `/${key}`, detail: 'Unknown field.' });
    }
  }
  const schoolName = requiredText(record.schoolName, '/schoolName', 'School name', errors);
  const fullName = requiredText(record.fullName, '/fullName', 'Name', errors);
  const email = emailValue(record.email, errors);
  const password = typeof record.password === 'string' ? record.password : '';
  if (typeof record.password !== 'string') errors.push({ pointer: '/password', detail: 'Password is required.' });
  if (email && typeof record.password === 'string') {
    const policy = passwordError(password, email);
    if (policy) errors.push(policy);
  }
  if (errors.length > 0) throw new ValidationFailed(errors);
  return { schoolName, fullName, email, password };
}

function parseCredentials(body: unknown): { email: string; password: string } {
  const record = objectBody(body);
  const errors: FieldError[] = [];
  for (const key of Object.keys(record)) {
    if (key !== 'email' && key !== 'password') errors.push({ pointer: `/${key}`, detail: 'Unknown field.' });
  }
  const email = emailValue(record.email, errors);
  if (typeof record.password !== 'string' || record.password.length === 0) {
    errors.push({ pointer: '/password', detail: 'Password is required.' });
  }
  if (errors.length > 0) throw new ValidationFailed(errors);
  return { email, password: String(record.password) };
}

function parseEmailBody(body: unknown): string {
  const record = objectBody(body);
  const errors: FieldError[] = [];
  for (const key of Object.keys(record)) {
    if (key !== 'email') errors.push({ pointer: `/${key}`, detail: 'Unknown field.' });
  }
  const email = emailValue(record.email, errors);
  if (errors.length > 0) throw new ValidationFailed(errors);
  return email;
}

function requiredToken(body: unknown): string {
  const token = parseTokenField(body, 'token');
  if (!token) throw new ValidationFailed([{ pointer: '/token', detail: 'Token is required.' }]);
  return token;
}

function requiredPassword(body: unknown): string {
  const record = objectBody(body);
  if (typeof record.password !== 'string') {
    throw new ValidationFailed([{ pointer: '/password', detail: 'Password is required.' }]);
  }
  return record.password;
}

function parseTokenField(body: unknown, key: 'token' | 'refreshToken'): string {
  const record = objectBody(body);
  const errors: FieldError[] = [];
  const allowed = key === 'refreshToken' ? ['refreshToken'] : ['token', 'password'];
  for (const field of Object.keys(record)) {
    if (!allowed.includes(field)) errors.push({ pointer: `/${field}`, detail: 'Unknown field.' });
  }
  if (errors.length > 0) throw new ValidationFailed(errors);
  const value = record[key];
  if (typeof value !== 'string') return '';
  return value.trim();
}

function passwordProblem(password: string): FieldError | null {
  if (password.length < 12 || password.length > 128 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return { pointer: '/password', detail: 'Password must be 12 to 128 characters and include a letter and a number.' };
  }
  if (/[\u0000-\u001f\u007f]/.test(password)) {
    return { pointer: '/password', detail: 'Password cannot include control characters.' };
  }
  return null;
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationFailed([{ detail: 'Request body must be an object.' }]);
  }
  return body as Record<string, unknown>;
}

function requiredText(value: unknown, pointer: string, label: string, errors: FieldError[]): string {
  if (typeof value !== 'string') {
    errors.push({ pointer, detail: `${label} is required.` });
    return '';
  }
  const text = value.trim();
  if (text.length < 1 || text.length > 200) {
    errors.push({ pointer, detail: `${label} must be between 1 and 200 characters.` });
  } else if (/[\u0000-\u001f\u007f]/.test(text)) {
    errors.push({ pointer, detail: `${label} cannot include control characters.` });
  }
  return text;
}

function emailValue(value: unknown, errors: FieldError[]): string {
  if (typeof value !== 'string') {
    errors.push({ pointer: '/email', detail: 'Email is required.' });
    return '';
  }
  const email = value.trim().toLocaleLowerCase('en');
  if (!isEmailAddress(email)) errors.push({ pointer: '/email', detail: 'Email is invalid.' });
  return email;
}
