import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isTeacherKey } from "./tokens";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function newUploadCode(): string {
  let out = "";
  while (out.length < 8) {
    const bytes = randomBytes(16);
    for (const byte of bytes) {
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === 8) break;
    }
  }
  return out;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function teacherKeyFrom(request: Request): string | null {
  const key = request.headers.get("x-teacher-key")?.trim() ?? "";
  return isTeacherKey(key) ? key : null;
}

export function codesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
