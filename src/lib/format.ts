import { ExamError } from "./errors";
import { LIMITS } from "./limits";
import type { DeskStudent, MarkCell, Question } from "./types";

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.length !== 8) return code;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function formatMarks(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number(rounded.toFixed(2)).toString();
}

export function sumCents(values: number[]): number {
  const cents = values.reduce((total, value) => total + Math.round(value * 100), 0);
  return cents / 100;
}

export function parseAwarded(input: unknown, maxMarks: number): number | null {
  if (input === null || input === "") return null;
  if (typeof input !== "number" && typeof input !== "string") {
    throw new ExamError(400, "Enter marks as a number.");
  }
  const text = String(input).trim();
  if (text === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new ExamError(400, "Enter marks with at most two decimal places.");
  }
  const value = Number(text);
  if (value > maxMarks) {
    throw new ExamError(400, `Marks cannot be above ${formatMarks(maxMarks)}.`);
  }
  return value;
}

export function parseMaxMarks(input: unknown): number {
  const value = typeof input === "number" ? input : typeof input === "string" ? Number(input.trim()) : NaN;
  if (!Number.isFinite(value) || value <= 0 || value > 1000) {
    throw new ExamError(400, "Maximum marks must be greater than 0 and at most 1000.");
  }
  const rounded = Math.round(value * 100) / 100;
  if (rounded <= 0) throw new ExamError(400, "Maximum marks must be greater than 0.");
  return rounded;
}

export function compareRoll(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function totalAwarded(marks: Pick<MarkCell, "awarded">[]): number | null {
  const values = marks.map((mark) => mark.awarded).filter((value): value is number => value != null);
  if (values.length === 0) return null;
  return sumCents(values);
}

export function scriptStatus(student: Pick<DeskStudent, "absent" | "validatedAt" | "pages">): string {
  if (student.absent && student.validatedAt) return "Absent, confirmed";
  if (student.absent) return "Marked absent";
  if (student.validatedAt) return "Validated";
  if (student.pages.length > 0) return "Script in";
  return "No script";
}

export function classSummary(students: DeskStudent[], questions: Question[]) {
  const maxTotal = sumCents(questions.map((question) => question.maxMarks));
  let scriptsIn = 0;
  let validated = 0;
  let absent = 0;
  const totals: number[] = [];
  for (const student of students) {
    if (student.pages.length > 0) scriptsIn += 1;
    if (student.validatedAt) validated += 1;
    if (student.absent) absent += 1;
    if (student.validatedAt && !student.absent) totals.push(totalAwarded(student.marks) ?? 0);
  }
  const average = totals.length === 0 ? null : Math.round((sumCents(totals) / totals.length) * 100) / 100;
  return {
    students: students.length,
    scriptsIn,
    validated,
    absent,
    average,
    maxTotal,
    marked: totals.length,
  };
}

export function fileSlug(parts: string[]): string {
  const slug = parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return slug || "class";
}

export function plainText(value: unknown, label: string, max: number, required: boolean): string {
  if (typeof value !== "string") {
    if (!required) return "";
    throw new ExamError(400, `${label} is required.`);
  }
  const text = value.trim().replace(/[\u0000-\u001f]/g, "");
  if (!text && required) throw new ExamError(400, `${label} is required.`);
  if (text.length > max) throw new ExamError(400, `${label} must be ${max} characters or fewer.`);
  return text;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExamError(400, "The request body must be an object.");
  }
  return value as Record<string, unknown>;
}

export { LIMITS };
