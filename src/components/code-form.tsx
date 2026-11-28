"use client";

import React, { useState, type FormEvent } from "react";
import { normalizeCode } from "@/src/lib/format";
import { Banner, Button, TextField } from "./ui";

export function CodeForm({
  students,
  pending,
  formError,
  onSubmit,
}: {
  students: { id: string; rollNo: string; name: string }[];
  pending: boolean;
  formError?: string;
  onSubmit: (code: string, studentId: string) => void;
}) {
  const [studentId, setStudentId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeCode(code);
    if (normalized.length !== 8) {
      setError("Enter the 8-character code from your teacher.");
      return;
    }
    setError("");
    onSubmit(normalized, studentId);
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <h2>Find your paper</h2>
      <p>Enter the code your teacher sent. You do not need an account.</p>
      {formError ? <Banner tone="error">{formError}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      <div className="field">
        <label htmlFor="student-name">Your name (optional)</label>
        <select id="student-name" value={studentId} onChange={(event) => setStudentId(event.target.value)}>
          <option value="">I will use the code only</option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.rollNo} · {student.name}
            </option>
          ))}
        </select>
      </div>
      <TextField
        id="upload-code"
        label="Upload code"
        value={code}
        onChange={setCode}
        hint="Eight letters or numbers, for example AB3K-7PQM."
        required
        autoComplete="one-time-code"
        spellCheck={false}
        maxLength={12}
      />
      <Button type="submit" pending={pending}>
        {pending ? "Checking code…" : "Continue"}
      </Button>
    </form>
  );
}
