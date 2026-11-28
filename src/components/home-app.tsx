"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExamForm } from "./exam-form";
import { SavedPapers } from "./saved-papers";
import { Banner, Button, CopyField, LoadingBlock } from "./ui";
import { apiJson } from "@/src/lib/browser";
import { examPayload, type ExamDraft } from "@/src/lib/drafts";
import { formatCode } from "@/src/lib/format";
import { extractTeacherKey } from "@/src/lib/tokens";
import { readDesks, rememberDesk, writeActiveKey, type SavedDesk } from "@/src/lib/storage";
import type { CreatedExam, DeskPayload } from "@/src/lib/types";

export function HomeApp() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState("");
  const [created, setCreated] = useState<CreatedExam | null>(null);
  const [slips, setSlips] = useState<DeskPayload | null>(null);
  const [slipError, setSlipError] = useState("");
  const [papers, setPapers] = useState<SavedDesk[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPapers(readDesks());
    setReady(true);
  }, []);

  function openDesk(key: string) {
    writeActiveKey(key);
    router.push("/desk");
  }

  async function create(draft: ExamDraft) {
    setPending(true);
    setFormError("");
    try {
      const result = await apiJson<CreatedExam>("/api/exams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(examPayload(draft)),
      });
      const saved: SavedDesk = {
        title: result.title,
        className: result.className,
        subject: result.subject,
        teacherKey: result.teacherKey,
        studentToken: result.studentToken,
        createdAt: new Date().toISOString(),
      };
      rememberDesk(saved);
      setPapers(readDesks());
      setCreated(result);
      setSlips(null);
      setSlipError("");
      try {
        setSlips(
          await apiJson<DeskPayload>("/api/desk", { headers: { "x-teacher-key": result.teacherKey } }),
        );
      } catch (error) {
        setSlipError(error instanceof Error ? error.message : "The class slips could not be loaded.");
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The paper could not be created.");
    } finally {
      setPending(false);
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="page">
      <div className="split">
        <div className="stack">
          <div>
            <h1>Set up a paper</h1>
            <p className="lede">Collect handwritten scripts, enter marks, and download the class mark list.</p>
          </div>
          {created ? (
            <section className="card">
              <h2>Paper created</h2>
              <Banner tone="info">
                Anyone with the teacher link can mark this class. Student links still need each upload code.
              </Banner>
              <p>
                {created.title} · {created.className} · {created.subject}
              </p>
              <CopyField label="Teacher link" value={`${origin}/desk#${created.teacherKey}`} />
              <CopyField label="Class upload link" value={`${origin}/s/${created.studentToken}`} />
              <div className="actions">
                <Button onClick={() => openDesk(created.teacherKey)}>Open marking desk</Button>
                <Button variant="secondary" onClick={() => setCreated(null)}>
                  Create another paper
                </Button>
              </div>
              {slipError ? <Banner tone="error">{slipError}</Banner> : null}
              {!slips && !slipError ? <LoadingBlock label="Loading student codes…" /> : null}
              {slips ? (
                <>
                  <h3>Student codes</h3>
                  <ul className="slip-list">
                    {slips.students.map((student) => {
                      const link = `${origin}/s/${created.studentToken}#${student.uploadCode}`;
                      const message = `Please upload your ${created.subject} script for ${created.className}: ${link}`;
                      return (
                        <li key={student.id}>
                          <strong>
                            {student.name} · {student.rollNo}
                          </strong>
                          <span>Code {formatCode(student.uploadCode)}</span>
                          <CopyField label={`Link for ${student.name}`} value={link} />
                          <a className="button button-secondary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
                            WhatsApp {student.name}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
            </section>
          ) : (
            <ExamForm onCreate={(draft) => void create(draft)} pending={pending} formError={formError} />
          )}
        </div>
        <aside className="stack">
          <section className="card">
            <h2>How it works</h2>
            <ol className="steps">
              <li>Name the paper and load the class.</li>
              <li>Send each student their upload link.</li>
              <li>Mark the scripts, validate, and download the mark list.</li>
            </ol>
          </section>
          <section className="card">
            <h2>Papers on this browser</h2>
            {ready ? <SavedPapers papers={papers} onOpen={openDesk} /> : <LoadingBlock label="Loading saved papers…" />}
            <OpenLink />
          </section>
        </aside>
      </div>
    </div>
  );
}

function OpenLink() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function open() {
    const key = extractTeacherKey(value);
    if (!key) {
      setError("Paste the teacher link or the private key.");
      return;
    }
    writeActiveKey(key);
    router.push("/desk");
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        open();
      }}
    >
      <h3>Open a teacher link</h3>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <label htmlFor="teacher-link">Teacher link</label>
      <input id="teacher-link" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" spellCheck={false} />
      <div className="actions">
        <Button type="submit" variant="secondary">
          Open desk
        </Button>
      </div>
    </form>
  );
}
