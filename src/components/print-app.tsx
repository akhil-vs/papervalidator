"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PrintSheet } from "./print-sheet";
import { Banner, Button, LoadingBlock } from "./ui";
import { apiJson } from "@/src/lib/browser";
import { readActiveKey } from "@/src/lib/storage";
import type { DeskPayload } from "@/src/lib/types";

export function PrintApp() {
  const params = useSearchParams();
  const requested = params.get("student") ?? "";
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [desk, setDesk] = useState<DeskPayload | null>(null);
  const [studentId, setStudentId] = useState(requested);
  const [error, setError] = useState("");

  useEffect(() => {
    const key = readActiveKey();
    if (!key) {
      setError("Open the marking desk before printing a sheet.");
      setPhase("error");
      return;
    }
    let cancelled = false;
    apiJson<DeskPayload>("/api/desk", { headers: { "x-teacher-key": key } })
      .then((payload) => {
        if (cancelled) return;
        setDesk(payload);
        setStudentId((current) => current || payload.students[0]?.id || "");
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "The sheet could not be loaded.");
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === "loading") {
    return (
      <div className="page">
        <LoadingBlock label="Loading the sheet…" />
      </div>
    );
  }

  if (phase === "error" || !desk) {
    return (
      <div className="page">
        <Banner tone="error">{error || "The sheet could not be loaded."}</Banner>
        <a className="button button-primary" href="/desk">
          Back to the desk
        </a>
      </div>
    );
  }

  const student = desk.students.find((item) => item.id === studentId) ?? desk.students[0];

  return (
    <div className="page stack">
      <div className="card no-print">
        <div className="field">
          <label htmlFor="print-student">Student</label>
          <select id="print-student" value={student?.id ?? ""} onChange={(event) => setStudentId(event.target.value)}>
            {desk.students.map((item) => (
              <option key={item.id} value={item.id}>
                {item.rollNo} · {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="actions">
          <Button onClick={() => window.print()}>Print sheet</Button>
          <a className="button button-secondary" href="/desk">
            Back to the desk
          </a>
        </div>
      </div>
      {student ? <PrintSheet exam={desk.exam} questions={desk.questions} student={student} /> : <Banner tone="error">This paper has no students.</Banner>}
    </div>
  );
}
