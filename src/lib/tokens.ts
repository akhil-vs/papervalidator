export function isTeacherKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,80}$/.test(value);
}

export function isStudentToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,64}$/.test(value);
}

export function isId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function extractTeacherKey(input: string): string | null {
  const trimmed = input.trim();
  if (isTeacherKey(trimmed)) return trimmed;
  const hash = trimmed.includes("#") ? trimmed.slice(trimmed.indexOf("#") + 1) : "";
  if (!hash) return null;
  try {
    const decoded = decodeURIComponent(hash);
    return isTeacherKey(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
