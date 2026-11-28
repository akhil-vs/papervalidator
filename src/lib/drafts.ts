import { ExamError } from "./errors";
import { parseAwarded, parseMaxMarks, plainText } from "./format";
import { LIMITS } from "./limits";
import type { Question } from "./types";

export type ExamDraft = {
  title: string;
  className: string;
  subject: string;
  teacherName: string;
  questions: { label: string; maxMarks: string }[];
  students: { rollNo: string; name: string }[];
};

export type MarkDraft = {
  absent: boolean;
  note: string;
  marks: { questionId: string; awarded: string; comment: string }[];
};

export type FieldErrors = Record<string, string>;

export const SAMPLE_DRAFT: ExamDraft = {
  title: "Midterm",
  className: "10 A",
  subject: "Mathematics",
  teacherName: "Meera Nair",
  questions: [
    { label: "1", maxMarks: "5" },
    { label: "2", maxMarks: "5" },
    { label: "3", maxMarks: "10" },
  ],
  students: [
    { rollNo: "1401", name: "Meera" },
    { rollNo: "1402", name: "Rohan" },
    { rollNo: "1403", name: "Iqbal" },
    { rollNo: "1404", name: "Lila" },
  ],
};

export function emptyDraft(): ExamDraft {
  return {
    title: "",
    className: "",
    subject: "",
    teacherName: "",
    questions: [{ label: "1", maxMarks: "" }],
    students: [{ rollNo: "", name: "" }],
  };
}

function catchError(errors: FieldErrors, key: string, run: () => void) {
  try {
    run();
  } catch (error) {
    if (error instanceof ExamError) errors[key] = error.message;
    else throw error;
  }
}

export function validateExamDraft(draft: ExamDraft): FieldErrors {
  const errors: FieldErrors = {};
  catchError(errors, "title", () => plainText(draft.title, "Exam name", LIMITS.maxTitle, true));
  catchError(errors, "className", () => plainText(draft.className, "Class", LIMITS.maxClass, true));
  catchError(errors, "subject", () => plainText(draft.subject, "Subject", LIMITS.maxSubject, true));
  catchError(errors, "teacherName", () => plainText(draft.teacherName, "Teacher", LIMITS.maxTeacher, true));

  if (draft.questions.length === 0) errors.questions = "Add at least one question.";
  else if (draft.questions.length > LIMITS.maxQuestions) {
    errors.questions = `A paper can have at most ${LIMITS.maxQuestions} questions.`;
  }
  draft.questions.forEach((question, index) => {
    catchError(errors, `question-${index}-label`, () => plainText(question.label, "Question", LIMITS.maxLabel, true));
    catchError(errors, `question-${index}-max`, () => parseMaxMarks(question.maxMarks));
  });

  if (draft.students.length === 0) errors.students = "Add at least one student.";
  else if (draft.students.length > LIMITS.maxStudents) {
    errors.students = `A class can have at most ${LIMITS.maxStudents} students.`;
  }
  const seen = new Set<string>();
  draft.students.forEach((student, index) => {
    catchError(errors, `student-${index}-roll`, () => {
      const roll = plainText(student.rollNo, "Admission number", LIMITS.maxRoll, true);
      const key = roll.toLowerCase();
      if (seen.has(key)) throw new ExamError(400, "Admission numbers must be unique.");
      seen.add(key);
    });
    catchError(errors, `student-${index}-name`, () => plainText(student.name, "Student name", LIMITS.maxName, true));
  });
  return errors;
}

export function examPayload(draft: ExamDraft) {
  return {
    title: plainText(draft.title, "Exam name", LIMITS.maxTitle, true),
    className: plainText(draft.className, "Class", LIMITS.maxClass, true),
    subject: plainText(draft.subject, "Subject", LIMITS.maxSubject, true),
    teacherName: plainText(draft.teacherName, "Teacher", LIMITS.maxTeacher, true),
    questions: draft.questions.map((question) => ({
      label: plainText(question.label, "Question", LIMITS.maxLabel, true),
      maxMarks: parseMaxMarks(question.maxMarks),
    })),
    students: draft.students.map((student) => ({
      rollNo: plainText(student.rollNo, "Admission number", LIMITS.maxRoll, true),
      name: plainText(student.name, "Student name", LIMITS.maxName, true),
    })),
  };
}

export function validateMarkDraft(draft: MarkDraft, questions: Question[], intent: "save" | "validate" | "reopen"): FieldErrors {
  const errors: FieldErrors = {};
  catchError(errors, "note", () => plainText(draft.note, "Comments", LIMITS.maxNote, false));
  if (draft.absent || intent === "reopen") return errors;
  for (const question of questions) {
    const cell = draft.marks.find((mark) => mark.questionId === question.id);
    catchError(errors, `comment-${question.id}`, () => plainText(cell?.comment ?? "", "Mistake note", LIMITS.maxComment, false));
    catchError(errors, `awarded-${question.id}`, () => {
      const value = parseAwarded(cell?.awarded ?? "", question.maxMarks);
      if (intent === "validate" && value == null) {
        throw new ExamError(400, `Enter marks for question ${question.label}.`);
      }
    });
  }
  return errors;
}

export function markPayload(draft: MarkDraft, intent: "save" | "validate" | "reopen") {
  return {
    absent: draft.absent,
    note: draft.note,
    validate: intent === "validate" ? true : intent === "reopen" ? false : null,
    marks: draft.marks.map((mark) => ({
      questionId: mark.questionId,
      awarded: mark.awarded.trim() === "" ? null : mark.awarded.trim(),
      comment: mark.comment,
    })),
  };
}

function headerKey(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function studentsFromSheet(matrix: unknown[][]): { students: { rollNo: string; name: string }[]; error?: string } {
  if (matrix.length === 0) return { students: [], error: "The spreadsheet is empty." };
  const header = (matrix[0] ?? []).map(headerKey);
  const serial = header.indexOf("slno");
  const admission = header.indexOf("admno");
  const name = header.indexOf("name");
  if (serial < 0 || admission < 0 || name < 0) {
    return { students: [], error: "The first row must include SlNo, AdmNo, and Name." };
  }
  const students: { rollNo: string; name: string; order: number }[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < matrix.length; index += 1) {
    const row = matrix[index] ?? [];
    const rollNo = String(row[admission] ?? "").trim();
    const studentName = String(row[name] ?? "").trim();
    if (!rollNo && !studentName) continue;
    if (!rollNo || !studentName) {
      return { students: [], error: `Row ${index + 1} needs both an admission number and a name.` };
    }
    const key = rollNo.toLowerCase();
    if (seen.has(key)) return { students: [], error: `Admission number ${rollNo} is repeated.` };
    seen.add(key);
    const order = Number(String(row[serial] ?? "").trim());
    students.push({ rollNo, name: studentName, order: Number.isFinite(order) ? order : index });
  }
  if (students.length === 0) return { students: [], error: "The class list has no students." };
  if (students.length > LIMITS.maxStudents) {
    return { students: [], error: `A class can have at most ${LIMITS.maxStudents} students.` };
  }
  students.sort((left, right) => left.order - right.order);
  return { students: students.map(({ rollNo, name: studentName }) => ({ rollNo, name: studentName })) };
}
