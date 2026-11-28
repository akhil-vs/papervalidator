"use client";

import React, { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { MarkForm } from "./mark-form";
import { ScriptPanel, type ScriptPage } from "./script-panel";
import { StudentRail } from "./student-rail";
import { Banner, Button, CopyField, LoadingBlock } from "./ui";
import { apiBlob, apiJson, downloadBlob } from "@/src/lib/browser";
import { markPayload, validateMarkDraft, type MarkDraft } from "@/src/lib/drafts";
import { classSummary, formatCode, formatMarks } from "@/src/lib/format";
import { clearActiveKey, readActiveKey, writeActiveKey } from "@/src/lib/storage";
import { extractTeacherKey } from "@/src/lib/tokens";
import type { DeskPayload, DeskStudent } from "@/src/lib/types";

type Pane = "students" | "script" | "marks";

function draftFrom(student: DeskStudent): MarkDraft {
  return {
    absent: student.absent,
    note: student.note,
    marks: student.marks.map((mark) => ({
      questionId: mark.questionId,
      awarded: mark.awarded == null ? "" : String(mark.awarded),
      comment: mark.comment,
    })),
  };
}

export function DeskApp() {
  const [phase, setPhase] = useState<"boot" | "needs-key" | "loading" | "ready" | "error">("boot");
  const [key, setKey] = useState("");
  const [desk, setDesk] = useState<DeskPayload | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<MarkDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState("");
  const [pane, setPane] = useState<Pane>("students");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [pages, setPages] = useState<ScriptPage[]>([]);
  const [pagesState, setPagesState] = useState<"loading" | "empty" | "error" | "ready">("empty");
  const [pageError, setPageError] = useState("");
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    const fromHash = extractTeacherKey(window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : "");
    const next = fromHash || readActiveKey();
    if (fromHash) {
      writeActiveKey(fromHash);
      window.history.replaceState(null, "", "/desk");
    }
    if (!next) {
      setPhase("needs-key");
      return;
    }
    setKey(next);
  }, []);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setPhase("loading");
    setError("");
    apiJson<DeskPayload>("/api/desk", { headers: { "x-teacher-key": key } })
      .then((payload) => {
        if (cancelled) return;
        setDesk(payload);
        setSelectedId(payload.students[0]?.id || "");
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        clearActiveKey();
        setError(reason instanceof Error ? reason.message : "The desk could not be opened.");
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const student = desk?.students.find((item) => item.id === selectedId) ?? null;

  const shownStudent = useRef("");
  useEffect(() => {
    if (!desk || shownStudent.current === selectedId) return;
    shownStudent.current = selectedId;
    const current = desk.students.find((item) => item.id === selectedId);
    if (!current) {
      setDraft(null);
      setSavedDraft("");
      return;
    }
    const next = draftFrom(current);
    setDraft(next);
    setSavedDraft(JSON.stringify(next));
    setFormError("");
    setSavedMessage("");
  }, [desk, selectedId]);

  const pageSignature = student?.pages.map((page) => page.id).join(",") ?? "";

  useEffect(() => {
    if (!student || !key) return;
    let cancelled = false;
    const urls: string[] = [];
    const currentPages = student.pages;
    setPagesState(currentPages.length === 0 ? "empty" : "loading");
    setPageError("");
    if (currentPages.length === 0) {
      setPages([]);
      return;
    }
    void (async () => {
      try {
        const next: ScriptPage[] = [];
        for (const page of currentPages) {
          const file = await apiBlob(`/api/pages/${page.id}`, { headers: { "x-teacher-key": key } });
          if (cancelled) return;
          const url = URL.createObjectURL(file.blob);
          urls.push(url);
          next.push({ id: page.id, filename: page.filename, mime: page.mime, url });
        }
        if (!cancelled) {
          setPages(next);
          setPagesState("ready");
        }
      } catch (reason) {
        if (!cancelled) {
          setPages([]);
          setPagesState("error");
          setPageError(reason instanceof Error ? reason.message : "The script could not be loaded.");
        }
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [pageSignature, key, student?.id]);

  const summary = useMemo(() => (desk ? classSummary(desk.students, desk.questions) : null), [desk]);
  const dirty = draft ? JSON.stringify(draft) !== savedDraft : false;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  function choose(id: string) {
    if (id === selectedId) {
      setPane("marks");
      return;
    }
    if (dirty) {
      setLeaveTarget(id);
      return;
    }
    setSelectedId(id);
    setPane(studentHasPages(desk, id) ? "script" : "marks");
  }

  async function save(next: MarkDraft, intent: "save" | "validate" | "reopen") {
    if (!desk || !student) return;
    const problems = validateMarkDraft(next, desk.questions, intent);
    if (Object.keys(problems).length > 0) return;
    setPending(true);
    setFormError("");
    setSavedMessage("");
    try {
      const payload = await apiJson<DeskPayload>(`/api/students/${student.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-teacher-key": key },
        body: JSON.stringify(markPayload(next, intent)),
      });
      setDesk(payload);
      const updated = payload.students.find((item) => item.id === student.id);
      if (updated) {
        const fresh = draftFrom(updated);
        setDraft(fresh);
        setSavedDraft(JSON.stringify(fresh));
      }
      setSavedMessage(intent === "validate" ? `Validated ${student.name}.` : intent === "reopen" ? `Reopened ${student.name}.` : `Saved ${student.name}.`);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "The marks could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function download() {
    setFormError("");
    try {
      const file = await apiBlob("/api/desk/marklist", { headers: { "x-teacher-key": key } });
      downloadBlob(file.blob, file.filename);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "The mark list could not be downloaded.");
    }
  }

  function openPasted(event: FormEvent) {
    event.preventDefault();
    const next = extractTeacherKey(linkValue);
    if (!next) {
      setLinkError("Paste the teacher link or the private key.");
      return;
    }
    setLinkError("");
    writeActiveKey(next);
    setKey(next);
  }

  if (phase === "boot" || phase === "loading") {
    return (
      <div className="page">
        <LoadingBlock label="Opening the desk…" />
      </div>
    );
  }

  if (phase !== "ready" || !desk || !summary) {
    return (
      <div className="page">
        <h1>Marking desk</h1>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <form className="card" onSubmit={openPasted}>
          <h2>Open a teacher link</h2>
          {linkError ? <Banner tone="error">{linkError}</Banner> : null}
          <label htmlFor="desk-link">Teacher link</label>
          <input id="desk-link" value={linkValue} onChange={(event) => setLinkValue(event.target.value)} autoComplete="off" spellCheck={false} />
          <div className="actions">
            <Button type="submit">Open desk</Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="stack">
        <div>
          <h1>{desk.exam.title}</h1>
          <p className="lede">
            {desk.exam.className} · {desk.exam.subject} · {desk.exam.teacherName}
          </p>
        </div>
        <ul className="stats" aria-label="Class summary">
          <li>
            <strong>{summary.students}</strong> Students
          </li>
          <li>
            <strong>{summary.scriptsIn}</strong> Scripts in
          </li>
          <li>
            <strong>{summary.validated}</strong> Validated
          </li>
          <li>
            <strong>{summary.absent}</strong> Absent
          </li>
          <li>
            <strong>{summary.average == null ? "—" : formatMarks(summary.average)}</strong>
            <span>Average of validated papers</span>
          </li>
        </ul>
        {formError && !student ? <Banner tone="error">{formError}</Banner> : null}
        <div className="actions no-print">
          <Button variant="secondary" onClick={() => void download()}>
            Download mark list
          </Button>
          {student ? (
            <a className="button button-secondary" href={`/desk/print?student=${student.id}`}>
              Print sheet
            </a>
          ) : null}
        </div>
        <p className="hint">The mark list uses Absent, or the total entered so far. A present paper with no marks counts as 0.</p>
        <section className="card">
          <h2>Share</h2>
          <CopyField label="Class upload link" value={`${origin}/s/${desk.exam.studentToken}`} />
          {student ? (
            <p>
              {student.name} code {formatCode(student.uploadCode)}
            </p>
          ) : null}
        </section>
        <div className="desk-tabs" role="tablist" aria-label="Desk sections">
          {(
            [
              ["students", "Students"],
              ["script", "Script"],
              ["marks", "Marks"],
            ] as const
          ).map(([id, label]) => (
            <Button key={id} role="tab" aria-selected={pane === id} aria-controls={`pane-${id}`} variant={pane === id ? "primary" : "secondary"} onClick={() => setPane(id)}>
              {label}
            </Button>
          ))}
        </div>
        <div className="desk-board">
          <section id="pane-students" className={pane === "students" ? "desk-pane is-active" : "desk-pane"} role="tabpanel" aria-label="Students">
            <StudentRail students={desk.students} selectedId={selectedId} onSelect={choose} />
          </section>
          <section id="pane-script" className={`card ${pane === "script" ? "desk-pane is-active" : "desk-pane"}`} role="tabpanel" aria-label="Script">
            <ScriptPanel state={pagesState} pages={pages} error={pageError} />
          </section>
          <section id="pane-marks" className={`card ${pane === "marks" ? "desk-pane is-active" : "desk-pane"}`} role="tabpanel" aria-label="Marks">
            {student && draft ? (
              <MarkForm
                studentName={student.name}
                questions={desk.questions}
                draft={draft}
                onChange={setDraft}
                validated={Boolean(student.validatedAt)}
                pending={pending}
                formError={formError}
                savedMessage={savedMessage}
                onSubmit={(next, intent) => void save(next, intent)}
                onReopen={() => void save(draft, "reopen")}
              />
            ) : (
              <EmptyDesk />
            )}
          </section>
        </div>
      </div>
      {leaveTarget ? (
        <div className="dialog-backdrop">
          <div className="dialog" role="alertdialog" aria-labelledby="leave-title" aria-describedby="leave-copy" tabIndex={-1}>
            <h2 id="leave-title">Leave this student without saving?</h2>
            <p id="leave-copy">The marks you typed for this student have not been saved.</p>
            <div className="actions">
              <Button
                onClick={() => {
                  setSelectedId(leaveTarget);
                  setPane("marks");
                  setLeaveTarget(null);
                }}
              >
                Discard changes
              </Button>
              <Button variant="secondary" onClick={() => setLeaveTarget(null)}>
                Keep editing
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function studentHasPages(desk: DeskPayload | null, id: string): boolean {
  return Boolean(desk?.students.find((item) => item.id === id)?.pages.length);
}

function EmptyDesk() {
  return <p>Select a student to enter marks.</p>;
}
