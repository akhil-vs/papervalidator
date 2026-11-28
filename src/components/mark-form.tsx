"use client";

import React, { useEffect, useState, type FormEvent } from "react";
import { validateMarkDraft, type MarkDraft } from "@/src/lib/drafts";
import { formatMarks } from "@/src/lib/format";
import type { Question } from "@/src/lib/types";
import { Banner, Button, TextArea, TextField } from "./ui";

export function MarkForm({
  studentName,
  questions,
  draft,
  onChange,
  validated,
  pending,
  formError,
  savedMessage,
  onSubmit,
  onReopen,
}: {
  studentName: string;
  questions: Question[];
  draft: MarkDraft;
  onChange: (draft: MarkDraft) => void;
  validated: boolean;
  pending: boolean;
  formError?: string;
  savedMessage?: string;
  onSubmit: (draft: MarkDraft, intent: "save" | "validate") => void;
  onReopen: () => void;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [intent, setIntent] = useState<"save" | "validate">("save");
  const [attempt, setAttempt] = useState(0);
  const errors = submitted ? validateMarkDraft(draft, questions, intent) : {};

  useEffect(() => {
    setSubmitted(false);
  }, [studentName]);

  useEffect(() => {
    if (attempt > 0) document.getElementById("mark-summary")?.focus();
  }, [attempt]);

  function run(nextIntent: "save" | "validate") {
    setIntent(nextIntent);
    setSubmitted(true);
    const next = validateMarkDraft(draft, questions, nextIntent);
    if (Object.keys(next).length > 0) {
      setAttempt((value) => value + 1);
      return;
    }
    onSubmit(draft, nextIntent);
  }

  function onFormSubmit(event: FormEvent) {
    event.preventDefault();
    run("save");
  }

  return (
    <form onSubmit={onFormSubmit} noValidate aria-busy={pending || undefined}>
      <h2>Marks for {studentName}</h2>
      {submitted && Object.keys(errors).length > 0 ? (
        <div id="mark-summary" tabIndex={-1}>
          <Banner tone="error">Fix the highlighted fields before saving.</Banner>
        </div>
      ) : null}
      {formError ? <Banner tone="error">{formError}</Banner> : null}
      {savedMessage ? <Banner tone="success">{savedMessage}</Banner> : null}
      <div className="field">
        <span className="label" id="attendance-label">
          Attendance
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="attendance-label">
          <Button
            variant="secondary"
            role="radio"
            aria-checked={!draft.absent}
            disabled={validated}
            onClick={() => onChange({ ...draft, absent: false })}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") onChange({ ...draft, absent: !draft.absent });
            }}
          >
            Present
          </Button>
          <Button
            variant="secondary"
            role="radio"
            aria-checked={draft.absent}
            disabled={validated}
            onClick={() => onChange({ ...draft, absent: true })}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") onChange({ ...draft, absent: !draft.absent });
            }}
          >
            Absent
          </Button>
        </div>
      </div>
      {draft.absent ? (
        <p>Absent in the Exam. The mark list will say Absent.</p>
      ) : (
        draft.marks.map((mark) => {
          const question = questions.find((item) => item.id === mark.questionId);
          if (!question) return null;
          return (
            <div className="question-row" key={question.id}>
              <p>
                <strong>Question {question.label}</strong>
                <span className="muted"> Out of {formatMarks(question.maxMarks)}</span>
              </p>
              <TextArea
                id={`comment-${question.id}`}
                label="Mistakes"
                value={mark.comment}
                onChange={(comment) =>
                  onChange({
                    ...draft,
                    marks: draft.marks.map((item) => (item.questionId === question.id ? { ...item, comment } : item)),
                  })
                }
                error={errors[`comment-${question.id}`]}
                disabled={validated}
                maxLength={200}
              />
              <TextField
                id={`awarded-${question.id}`}
                label="Obtained marks"
                value={mark.awarded}
                onChange={(awarded) =>
                  onChange({
                    ...draft,
                    marks: draft.marks.map((item) => (item.questionId === question.id ? { ...item, awarded } : item)),
                  })
                }
                error={errors[`awarded-${question.id}`]}
                hint={`At most ${formatMarks(question.maxMarks)}, up to two decimal places.`}
                required
                disabled={validated}
                inputMode="decimal"
              />
            </div>
          );
        })
      )}
      <TextArea
        id="student-note"
        label="Other comments"
        value={draft.note}
        onChange={(note) => onChange({ ...draft, note })}
        error={errors.note}
        disabled={validated}
        maxLength={200}
      />
      <div className="actions">
        {validated ? (
          <Button variant="secondary" onClick={onReopen} pending={pending}>
            Reopen paper
          </Button>
        ) : (
          <>
            <Button type="submit" pending={pending}>
              {pending ? "Saving…" : "Save marks"}
            </Button>
            <Button variant="secondary" onClick={() => run("validate")} pending={pending}>
              Validate paper
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
