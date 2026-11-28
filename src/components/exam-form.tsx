"use client";

import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { emptyDraft, SAMPLE_DRAFT, validateExamDraft, type ExamDraft } from "@/src/lib/drafts";
import { apiJson } from "@/src/lib/browser";
import { Banner, Button, TextField } from "./ui";

export function ExamForm({
  onCreate,
  pending,
  formError,
}: {
  onCreate: (draft: ExamDraft) => void;
  pending: boolean;
  formError?: string;
}) {
  const [draft, setDraft] = useState<ExamDraft>(emptyDraft);
  const [submitted, setSubmitted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [sheetError, setSheetError] = useState("");
  const [sheetPending, setSheetPending] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const errors = submitted ? validateExamDraft(draft) : {};
  const invalid = Object.keys(errors).length > 0;

  useEffect(() => {
    if (attempt > 0) summaryRef.current?.focus();
  }, [attempt]);

  function update(patch: Partial<ExamDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    const next = validateExamDraft(draft);
    if (Object.keys(next).length > 0) {
      setAttempt((value) => value + 1);
      return;
    }
    onCreate(draft);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setSheetError("Choose an .xlsx class list.");
      return;
    }
    setSheetPending(true);
    setSheetError("");
    try {
      const body = new FormData();
      body.set("file", file);
      const result = await apiJson<{ students: ExamDraft["students"] }>("/api/roster", { method: "POST", body });
      setDraft((current) => ({ ...current, students: result.students }));
    } catch (error) {
      setSheetError(error instanceof Error ? error.message : "The class list could not be read.");
    } finally {
      setSheetPending(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} noValidate aria-busy={pending || undefined}>
      <h2>Paper details</h2>
      {submitted && invalid ? (
        <div ref={summaryRef} tabIndex={-1}>
          <Banner tone="error">Fix the highlighted fields before creating the paper.</Banner>
        </div>
      ) : null}
      {formError ? <Banner tone="error">{formError}</Banner> : null}
      {sheetError ? <Banner tone="error">{sheetError}</Banner> : null}
      <TextField id="exam-title" label="Exam name" value={draft.title} onChange={(title) => update({ title })} error={errors.title} required autoComplete="off" maxLength={120} />
      <TextField id="exam-class" label="Class" value={draft.className} onChange={(className) => update({ className })} error={errors.className} required autoComplete="off" maxLength={40} />
      <TextField id="exam-subject" label="Subject" value={draft.subject} onChange={(subject) => update({ subject })} error={errors.subject} required autoComplete="off" maxLength={80} />
      <TextField id="exam-teacher" label="Teacher" value={draft.teacherName} onChange={(teacherName) => update({ teacherName })} error={errors.teacherName} required autoComplete="name" maxLength={80} />

      <h3>Questions</h3>
      {errors.questions ? <p className="field-error">{errors.questions}</p> : null}
      {draft.questions.map((question, index) => (
        <div className="question-row" key={`question-${index}`}>
          <TextField
            id={`question-${index}-label`}
            label={`Question ${index + 1}`}
            value={question.label}
            onChange={(label) => {
              const questions = draft.questions.slice();
              questions[index] = { ...question, label };
              update({ questions });
            }}
            error={errors[`question-${index}-label`]}
            required
            maxLength={80}
          />
          <TextField
            id={`question-${index}-max`}
            label="Maximum marks"
            value={question.maxMarks}
            onChange={(maxMarks) => {
              const questions = draft.questions.slice();
              questions[index] = { ...question, maxMarks };
              update({ questions });
            }}
            error={errors[`question-${index}-max`]}
            hint="Greater than 0, at most 1000, up to two decimal places."
            required
            inputMode="decimal"
          />
          {draft.questions.length > 1 ? (
            <Button
              variant="quiet"
              onClick={() => update({ questions: draft.questions.filter((_, item) => item !== index) })}
            >
              Remove question {index + 1}
            </Button>
          ) : null}
        </div>
      ))}
      <div className="actions">
        <Button
          variant="secondary"
          onClick={() => update({ questions: [...draft.questions, { label: String(draft.questions.length + 1), maxMarks: "" }] })}
        >
          Add question
        </Button>
      </div>

      <h3>Class list</h3>
      <p className="hint">The first row of an .xlsx file must be SlNo, AdmNo, and Name. Do not change those headers.</p>
      <div className="field">
        <label htmlFor="class-list">Upload class list</label>
        <input
          id="class-list"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => void onFile(event.target.files?.[0])}
          disabled={sheetPending}
          aria-busy={sheetPending || undefined}
        />
        {sheetPending ? <p role="status">Reading the class list…</p> : null}
      </div>
      {errors.students ? <p className="field-error">{errors.students}</p> : null}
      {draft.students.map((student, index) => (
        <div className="student-row" key={`student-${index}`}>
          <TextField
            id={`student-${index}-roll`}
            label="Admission number"
            value={student.rollNo}
            onChange={(rollNo) => {
              const students = draft.students.slice();
              students[index] = { ...student, rollNo };
              update({ students });
            }}
            error={errors[`student-${index}-roll`]}
            required
            autoComplete="off"
            maxLength={32}
          />
          <TextField
            id={`student-${index}-name`}
            label="Student name"
            value={student.name}
            onChange={(name) => {
              const students = draft.students.slice();
              students[index] = { ...student, name };
              update({ students });
            }}
            error={errors[`student-${index}-name`]}
            required
            autoComplete="off"
            maxLength={80}
          />
          {draft.students.length > 1 ? (
            <Button variant="quiet" onClick={() => update({ students: draft.students.filter((_, item) => item !== index) })}>
              Remove {student.name || `student ${index + 1}`}
            </Button>
          ) : null}
        </div>
      ))}
      <div className="actions">
        <Button variant="secondary" onClick={() => update({ students: [...draft.students, { rollNo: "", name: "" }] })}>
          Add student
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            setDraft(SAMPLE_DRAFT);
            setSheetError("");
          }}
        >
          Fill a sample class
        </Button>
      </div>
      <div className="actions">
        <Button type="submit" pending={pending}>
          {pending ? "Creating paper…" : "Create paper"}
        </Button>
      </div>
    </form>
  );
}
