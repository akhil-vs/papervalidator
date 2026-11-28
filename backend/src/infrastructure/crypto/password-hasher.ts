import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { PasswordHasher } from '../../application/auth-ports.js';
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_N = 262144;

export type ScryptCost = {
  N: number;
  r: number;
  p: number;
};

export const PRODUCTION_SCRYPT: ScryptCost = { N: 16384, r: 8, p: 1 };

export class ScryptHasher implements PasswordHasher {
  constructor(private readonly cost: ScryptCost = PRODUCTION_SCRYPT) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await derive(password, salt, this.cost);
    return encode(this.cost, salt, key);
  }

  async verify(password: string, passwordHash: string): Promise<boolean> {
    const parsed = decode(passwordHash);
    if (!parsed) {
      await derive(password, randomBytes(SALT_LENGTH), this.cost);
      return false;
    }
    const actual = await derive(password, parsed.salt, parsed.cost);
    if (actual.length !== parsed.key.length) return false;
    return timingSafeEqual(actual, parsed.key);
  }
}

function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: cost.N, r: cost.r, p: cost.p, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function encode(cost: ScryptCost, salt: Buffer, key: Buffer): string {
  return `scrypt$${cost.N}$${cost.r}$${cost.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

function decode(passwordHash: string): { cost: ScryptCost; salt: Buffer; key: Buffer } | null {
  const parts = passwordHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltPart = parts[4];
  const keyPart = parts[5];
  if (!saltPart || !keyPart) return null;
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N < 2 || N > MAX_N || (N & (N - 1)) !== 0 || r < 1 || r > 32 || p < 1 || p > 8) return null;
  const salt = Buffer.from(saltPart, 'base64url');
  const key = Buffer.from(keyPart, 'base64url');
  if (salt.length !== SALT_LENGTH || key.length !== KEY_LENGTH) return null;
  return { cost: { N, r, p }, salt, key };
}
