import { randomUUID } from "node:crypto";
import { codesEqual, hashKey, newToken, newUploadCode } from "./auth";
import { sql, withTransaction, type Row } from "./db";
import { ExamError } from "./errors";
import { safeFilename, sniffMime } from "./files";
import {
  asRecord,
  compareRoll,
  fileSlug,
  normalizeCode,
  parseAwarded,
  parseMaxMarks,
  plainText,
  totalAwarded,
} from "./format";
import { LIMITS } from "./limits";
import { isId, isStudentToken, isTeacherKey } from "./tokens";
import type { CreatedExam, DeskPayload, DeskStudent, PageInfo, PublicExam, Question, StoredPage, StudentSession } from "./types";
import * as XLSX from "xlsx";

type ExamRow = {
  id: string;
  title: string;
  class_name: string;
  subject: string;
  teacher_name: string;
  student_token: string;
  created_at: string | Date;
  code_fails: number | string;
  code_lock_until: string | Date | null;
};

export function creationAllowed(total: number, recent: number) {
  if (total >= LIMITS.maxExams) throw new ExamError(409, "The exam store is full.");
  if (recent >= LIMITS.maxCreatesPerHour) {
    throw new ExamError(429, "Too many exams were created this hour. Try again later.");
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBool(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

function locked(row: Pick<ExamRow, "code_lock_until">): boolean {
  if (!row.code_lock_until) return false;
  return new Date(row.code_lock_until).getTime() > Date.now();
}

async function registerFailure(examId: string) {
  await sql(
    `update exams
     set code_fails = code_fails + 1,
         code_lock_until = case
           when code_fails + 1 >= $2 then now() + interval '15 minutes'
           else code_lock_until
         end
     where id = $1`,
    [examId, LIMITS.codeFailures],
  );
}

function freshCode(used: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = newUploadCode();
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
  }
  throw new ExamError(500, "Could not assign upload codes. Try again.");
}

export function parseCreateBody(body: unknown) {
  const record = asRecord(body);
  const title = plainText(record.title, "Exam name", LIMITS.maxTitle, true);
  const className = plainText(record.className, "Class", LIMITS.maxClass, true);
  const subject = plainText(record.subject, "Subject", LIMITS.maxSubject, true);
  const teacherName = plainText(record.teacherName, "Teacher", LIMITS.maxTeacher, true);
  if (!Array.isArray(record.questions) || record.questions.length === 0) {
    throw new ExamError(400, "Add at least one question.");
  }
  if (record.questions.length > LIMITS.maxQuestions) {
    throw new ExamError(400, `A paper can have at most ${LIMITS.maxQuestions} questions.`);
  }
  if (!Array.isArray(record.students) || record.students.length === 0) {
    throw new ExamError(400, "Add at least one student.");
  }
  if (record.students.length > LIMITS.maxStudents) {
    throw new ExamError(400, `A class can have at most ${LIMITS.maxStudents} students.`);
  }
  const questions = record.questions.map((item) => {
    const question = asRecord(item);
    return {
      label: plainText(question.label, "Question", LIMITS.maxLabel, true),
      maxMarks: parseMaxMarks(question.maxMarks),
    };
  });
  const seen = new Set<string>();
  const students = record.students.map((item) => {
    const student = asRecord(item);
    const rollNo = plainText(student.rollNo, "Admission number", LIMITS.maxRoll, true);
    const key = rollNo.toLowerCase();
    if (seen.has(key)) throw new ExamError(400, "Admission numbers must be unique.");
    seen.add(key);
    return { rollNo, name: plainText(student.name, "Student name", LIMITS.maxName, true) };
  });
  return { title, className, subject, teacherName, questions, students };
}

export async function createExam(body: unknown): Promise<CreatedExam> {
  const input = parseCreateBody(body);
  const id = randomUUID();
  const teacherKey = newToken();
  const studentToken = newToken(24);
  const used = new Set<string>();
  const questionIds = input.questions.map(() => randomUUID());
  const studentRows = input.students.map((student) => ({ ...student, id: randomUUID(), code: freshCode(used) }));

  await withTransaction(async (query) => {
    const totals = await query<{ count: number | string }>("select count(*)::int as count from exams");
    const recent = await query<{ count: number | string }>(
      "select count(*)::int as count from exams where created_at > now() - interval '1 hour'",
    );
    creationAllowed(Number(totals[0]?.count ?? 0), Number(recent[0]?.count ?? 0));
    await query(
      `insert into exams (id, title, class_name, subject, teacher_name, teacher_key_hash, student_token)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, input.title, input.className, input.subject, input.teacherName, hashKey(teacherKey), studentToken],
    );
    for (let index = 0; index < input.questions.length; index += 1) {
      const question = input.questions[index];
      await query("insert into questions (id, exam_id, position, label, max_marks) values ($1, $2, $3, $4, $5)", [
        questionIds[index],
        id,
        index + 1,
        question.label,
        question.maxMarks,
      ]);
    }
    for (const student of studentRows) {
      await query(
        "insert into students (id, exam_id, roll_no, name, upload_code) values ($1, $2, $3, $4, $5)",
        [student.id, id, student.rollNo, student.name, student.code],
      );
      for (const questionId of questionIds) {
        await query("insert into marks (student_id, question_id, awarded, comment) values ($1, $2, null, '')", [
          student.id,
          questionId,
        ]);
      }
    }
  });

  return {
    teacherKey,
    studentToken,
    title: input.title,
    className: input.className,
    subject: input.subject,
    teacherName: input.teacherName,
    studentCount: input.students.length,
    questionCount: input.questions.length,
  };
}

async function examByKey(teacherKey: string): Promise<ExamRow> {
  if (!isTeacherKey(teacherKey)) throw new ExamError(401, "That teacher link does not match an exam.");
  const rows = await sql<ExamRow>("select * from exams where teacher_key_hash = $1", [hashKey(teacherKey)]);
  const exam = rows[0];
  if (!exam) throw new ExamError(401, "That teacher link does not match an exam.");
  return exam;
}

async function examByToken(token: string): Promise<ExamRow> {
  if (!isStudentToken(token)) throw new ExamError(404, "This upload link is not valid.");
  const rows = await sql<ExamRow>("select * from exams where student_token = $1", [token]);
  const exam = rows[0];
  if (!exam) throw new ExamError(404, "This upload link is not valid.");
  return exam;
}

function mapQuestions(rows: Row[]): Question[] {
  return rows
    .map((row) => ({
      id: String(row.id),
      position: Number(row.position),
      label: String(row.label),
      maxMarks: Number(row.max_marks),
    }))
    .sort((left, right) => left.position - right.position);
}

async function questionsFor(examId: string): Promise<Question[]> {
  return mapQuestions(await sql("select id, position, label, max_marks from questions where exam_id = $1", [examId]));
}

async function studentsFor(examId: string, questions: Question[]): Promise<DeskStudent[]> {
  const students = await sql(
    "select id, roll_no, name, upload_code, absent, validated_at, note from students where exam_id = $1",
    [examId],
  );
  const pages = await sql(
    `select pages.id, pages.student_id, pages.position, pages.filename, pages.mime
     from pages join students on students.id = pages.student_id
     where students.exam_id = $1`,
    [examId],
  );
  const marks = await sql(
    `select marks.student_id, marks.question_id, marks.awarded, marks.comment
     from marks join students on students.id = marks.student_id
     where students.exam_id = $1`,
    [examId],
  );
  return students
    .map((student) => {
      const id = String(student.id);
      const pageRows = pages
        .filter((page) => String(page.student_id) === id)
        .map((page) => ({
          id: String(page.id),
          position: Number(page.position),
          filename: String(page.filename),
          mime: String(page.mime),
        }))
        .sort((left, right) => left.position - right.position);
      const markRows = marks.filter((mark) => String(mark.student_id) === id);
      return {
        id,
        rollNo: String(student.roll_no),
        name: String(student.name),
        uploadCode: String(student.upload_code),
        absent: toBool(student.absent),
        validatedAt: student.validated_at ? toIso(student.validated_at) : null,
        note: String(student.note ?? ""),
        pages: pageRows,
        marks: questions.map((question) => {
          const mark = markRows.find((item) => String(item.question_id) === question.id);
          return {
            questionId: question.id,
            awarded: mark ? toNumber(mark.awarded) : null,
            comment: mark ? String(mark.comment ?? "") : "",
          };
        }),
      };
    })
    .sort((left, right) => compareRoll(left.rollNo, right.rollNo));
}

function deskExam(exam: ExamRow): DeskPayload["exam"] {
  return {
    id: exam.id,
    title: exam.title,
    className: exam.class_name,
    subject: exam.subject,
    teacherName: exam.teacher_name,
    studentToken: exam.student_token,
    createdAt: toIso(exam.created_at),
  };
}

export async function loadDesk(teacherKey: string): Promise<DeskPayload> {
  const exam = await examByKey(teacherKey);
  const questions = await questionsFor(exam.id);
  const students = await studentsFor(exam.id, questions);
  return { exam: deskExam(exam), questions, students };
}

export async function loadPublicExam(token: string): Promise<PublicExam> {
  const exam = await examByToken(token);
  const students = await sql<{ id: string; roll_no: string; name: string }>(
    "select id, roll_no, name from students where exam_id = $1",
    [exam.id],
  );
  return {
    title: exam.title,
    className: exam.class_name,
    subject: exam.subject,
    teacherName: exam.teacher_name,
    students: students
      .map((student) => ({ id: String(student.id), rollNo: String(student.roll_no), name: String(student.name) }))
      .sort((left, right) => compareRoll(left.rollNo, right.rollNo)),
  };
}

async function pagesForStudent(studentId: string): Promise<PageInfo[]> {
  const rows = await sql(
    "select id, position, filename, mime from pages where student_id = $1 order by position",
    [studentId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    position: Number(row.position),
    filename: String(row.filename),
    mime: String(row.mime),
  }));
}

function sessionFrom(student: Row, pages: PageInfo[]): StudentSession {
  return {
    student: {
      id: String(student.id),
      rollNo: String(student.roll_no),
      name: String(student.name),
      absent: toBool(student.absent),
      validatedAt: student.validated_at ? toIso(student.validated_at) : null,
    },
    pages,
  };
}

export async function openSession(token: string, rawCode: string, studentId?: string): Promise<StudentSession> {
  const exam = await examByToken(token);
  if (locked(exam)) throw new ExamError(429, "Too many attempts. Try again later.");
  const code = normalizeCode(rawCode);
  const students = await sql("select * from students where exam_id = $1", [exam.id]);
  const match = students.find((student) => codesEqual(normalizeCode(String(student.upload_code)), code));
  const chosen = studentId ? students.find((student) => String(student.id) === studentId) : undefined;
  if (!match || code.length !== 8 || (studentId && chosen?.id !== match.id)) {
    await registerFailure(exam.id);
    throw new ExamError(401, "That code does not match a student on this paper.");
  }
  await sql("update exams set code_fails = 0, code_lock_until = null where id = $1", [exam.id]);
  return sessionFrom(match, await pagesForStudent(String(match.id)));
}

export async function addPage(
  studentId: string,
  rawCode: string,
  file: { filename: string; bytes: Uint8Array },
  replace: boolean,
): Promise<StudentSession> {
  if (!isId(studentId)) throw new ExamError(404, "That student was not found.");
  const rows = await sql("select * from students where id = $1", [studentId]);
  const student = rows[0];
  if (!student) throw new ExamError(404, "That student was not found.");
  const code = normalizeCode(rawCode);
  if (!codesEqual(code, normalizeCode(String(student.upload_code)))) {
    throw new ExamError(401, "That code does not match a student on this paper.");
  }
  if (student.validated_at) throw new ExamError(409, "This script is locked.");
  if (file.bytes.byteLength === 0) throw new ExamError(400, "That file is empty.");
  if (file.bytes.byteLength > LIMITS.maxFileBytes) throw new ExamError(413, "Each page must be 6 MB or smaller.");
  const mime = sniffMime(file.bytes);
  if (!mime) throw new ExamError(400, "Save the page as a JPG, PNG, WEBP, or PDF.");

  await withTransaction(async (query) => {
    const existing = await query<{ count: number | string }>(
      "select count(*)::int as count from pages where student_id = $1",
      [studentId],
    );
    const count = Number(existing[0]?.count ?? 0);
    if (replace) await query("delete from pages where student_id = $1", [studentId]);
    else if (count >= LIMITS.maxPagesPerStudent) {
      throw new ExamError(400, `A script can have at most ${LIMITS.maxPagesPerStudent} pages.`);
    }
    const positions = await query<{ position: number | string }>(
      "select coalesce(max(position), 0) + 1 as position from pages where student_id = $1",
      [studentId],
    );
    await query("insert into pages (id, student_id, position, filename, mime, bytes) values ($1, $2, $3, $4, $5, $6)", [
      randomUUID(),
      studentId,
      Number(positions[0]?.position ?? 1),
      safeFilename(file.filename),
      mime,
      Buffer.from(file.bytes),
    ]);
  });
  const fresh = await sql("select * from students where id = $1", [studentId]);
  return sessionFrom(fresh[0], await pagesForStudent(studentId));
}

export async function readPage(
  pageId: string,
  auth: { teacherKey?: string | null; uploadCode?: string | null },
): Promise<StoredPage> {
  if (!isId(pageId)) throw new ExamError(404, "That page was not found.");
  const rows = await sql(
    `select pages.mime, pages.filename, pages.bytes, pages.student_id, students.upload_code, exams.teacher_key_hash
     from pages
     join students on students.id = pages.student_id
     join exams on exams.id = students.exam_id
     where pages.id = $1`,
    [pageId],
  );
  const page = rows[0];
  if (!page) throw new ExamError(404, "That page was not found.");
  const teacherOk = Boolean(auth.teacherKey && isTeacherKey(auth.teacherKey) && hashKey(auth.teacherKey) === page.teacher_key_hash);
  const code = normalizeCode(auth.uploadCode ?? "");
  const studentOk = codesEqual(code, normalizeCode(String(page.upload_code)));
  if (!teacherOk && !studentOk) throw new ExamError(401, "That page is not available with this link.");
  const bytes = page.bytes instanceof Uint8Array ? page.bytes : Buffer.from(page.bytes as string, "hex");
  return { mime: String(page.mime), filename: String(page.filename), bytes };
}

export function parseStudentPatch(body: unknown, questions: Question[]) {
  const record = asRecord(body);
  if (typeof record.absent !== "boolean") throw new ExamError(400, "Choose present or absent.");
  const note = plainText(record.note, "Comments", LIMITS.maxNote, false);
  let validate: boolean | null = null;
  if (record.validate === true) validate = true;
  else if (record.validate === false) validate = false;
  else if (record.validate != null) throw new ExamError(400, "Validation must be true or false.");
  if (!Array.isArray(record.marks)) throw new ExamError(400, "Include every question.");
  const seen = new Set<string>();
  const marks = record.marks.map((item) => {
    const mark = asRecord(item);
    const questionId = String(mark.questionId ?? "");
    const question = questions.find((entry) => entry.id === questionId);
    if (!question || seen.has(questionId)) throw new ExamError(400, "Include every question.");
    seen.add(questionId);
    return {
      questionId,
      awarded: parseAwarded(mark.awarded, question.maxMarks),
      comment: plainText(mark.comment, "Mistake note", LIMITS.maxComment, false),
    };
  });
  if (questions.some((question) => !seen.has(question.id))) throw new ExamError(400, "Include every question.");
  if (validate && !record.absent && marks.some((mark) => mark.awarded == null)) {
    throw new ExamError(400, "Enter a mark for every question before validating.");
  }
  return { absent: record.absent, note, validate, marks };
}

export async function updateStudent(teacherKey: string, studentId: string, body: unknown): Promise<DeskPayload> {
  if (!isId(studentId)) throw new ExamError(404, "That student was not found.");
  const exam = await examByKey(teacherKey);
  const questions = await questionsFor(exam.id);
  const patch = parseStudentPatch(body, questions);
  const owners = await sql<{ id: string }>("select id from students where id = $1 and exam_id = $2", [studentId, exam.id]);
  if (!owners[0]) throw new ExamError(404, "That student was not found.");
  await withTransaction(async (query) => {
    await query("update students set absent = $2, note = $3 where id = $1", [studentId, patch.absent, patch.note]);
    if (patch.validate === true) await query("update students set validated_at = now() where id = $1", [studentId]);
    if (patch.validate === false) await query("update students set validated_at = null where id = $1", [studentId]);
    for (const mark of patch.marks) {
      await query(
        `insert into marks (student_id, question_id, awarded, comment) values ($1, $2, $3, $4)
         on conflict (student_id, question_id) do update set awarded = excluded.awarded, comment = excluded.comment`,
        [studentId, mark.questionId, mark.awarded, mark.comment],
      );
    }
  });
  return loadDesk(teacherKey);
}

export async function buildMarklist(teacherKey: string): Promise<{ filename: string; body: Buffer }> {
  const desk = await loadDesk(teacherKey);
  const rows: (string | number)[][] = [["SlNo", "AdmNo", "Name", "Marks"]];
  desk.students.forEach((student, index) => {
    const marks = student.absent ? "Absent" : (totalAwarded(student.marks) ?? 0);
    rows.push([index + 1, student.rollNo, student.name, marks]);
  });
  const book = XLSX.utils.book_new();
  const sheetName = desk.exam.subject.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Marks";
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  const body = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { filename: `${fileSlug([desk.exam.subject, desk.exam.className])}.xlsx`, body };
}
