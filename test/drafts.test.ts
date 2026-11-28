import assert from "node:assert/strict";
import { test } from "node:test";
import { SAMPLE_DRAFT, emptyDraft, studentsFromSheet, validateExamDraft, validateMarkDraft } from "../src/lib/drafts";
import { creationAllowed } from "../src/lib/exam";
import { ExamError } from "../src/lib/errors";
import type { Question } from "../src/lib/types";

const questions: Question[] = [
  { id: "q1", position: 1, label: "1", maxMarks: 5 },
  { id: "q2", position: 2, label: "2", maxMarks: 10 },
];

test("sample paper passes client validation", () => {
  assert.deepEqual(validateExamDraft(SAMPLE_DRAFT), {});
});

test("empty paper reports each required field", () => {
  const errors = validateExamDraft(emptyDraft());
  assert.match(errors.title, /Exam name is required/);
  assert.match(errors.className, /Class is required/);
  assert.match(errors.subject, /Subject is required/);
  assert.match(errors.teacherName, /Teacher is required/);
  assert.match(errors["question-0-max"], /Maximum marks/);
  assert.match(errors["student-0-roll"], /Admission number is required/);
  assert.match(errors["student-0-name"], /Student name is required/);
});

test("duplicate admission numbers are rejected", () => {
  const draft = {
    ...SAMPLE_DRAFT,
    students: [
      { rollNo: "14", name: "Meera" },
      { rollNo: "14", name: "Rohan" },
    ],
  };
  assert.match(validateExamDraft(draft)["student-1-roll"], /unique/);
});

test("marks keep two decimal places and stay within the question maximum", () => {
  const draft = {
    absent: false,
    note: "",
    marks: [
      { questionId: "q1", awarded: "5.678", comment: "" },
      { questionId: "q2", awarded: "", comment: "" },
    ],
  };
  const saved = validateMarkDraft(draft, questions, "save");
  assert.match(saved["awarded-q1"], /two decimal places/);
  assert.equal(saved["awarded-q2"], undefined);
  const validated = validateMarkDraft(
    { ...draft, marks: [{ questionId: "q1", awarded: "4", comment: "" }, { questionId: "q2", awarded: "", comment: "" }] },
    questions,
    "validate",
  );
  assert.match(validated["awarded-q2"], /Enter marks for question 2/);
  const high = validateMarkDraft(
    { ...draft, marks: [{ questionId: "q1", awarded: "9", comment: "" }, { questionId: "q2", awarded: "1", comment: "" }] },
    questions,
    "save",
  );
  assert.match(high["awarded-q1"], /cannot be above 5/);
});

test("class list headers and repeated admission numbers", () => {
  const missing = studentsFromSheet([
    ["Roll", "Student"],
    ["1", "Meera"],
  ]);
  assert.match(missing.error ?? "", /SlNo, AdmNo, and Name/);
  const repeated = studentsFromSheet([
    ["SlNo", "AdmNo", "Name"],
    ["1", "1401", "Meera"],
    ["2", "1401", "Rohan"],
  ]);
  assert.match(repeated.error ?? "", /1401 is repeated/);
  const parsed = studentsFromSheet([
    [" Sl No ", "Adm No", "Name"],
    ["2", "1402", "Rohan"],
    ["1", "1401", "Meera"],
    ["", "", ""],
  ]);
  assert.deepEqual(parsed.students, [
    { rollNo: "1401", name: "Meera" },
    { rollNo: "1402", name: "Rohan" },
  ]);
});

test("creation limits", () => {
  assert.doesNotThrow(() => creationAllowed(1, 1));
  assert.throws(() => creationAllowed(2000, 0), (error: unknown) => error instanceof ExamError && error.status === 409);
  assert.throws(() => creationAllowed(1, 120), (error: unknown) => error instanceof ExamError && error.status === 429);
});
