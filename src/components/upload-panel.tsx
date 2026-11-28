"use client";

import React, { useState, type FormEvent } from "react";
import { LIMITS } from "@/src/lib/limits";
import { Banner, Button, EmptyState, LoadingBlock } from "./ui";
import type { ScriptPage } from "./script-panel";

const PAGE_PATTERN = /\.(jpe?g|png|webp|pdf)$/i;

export function UploadPanel({
  student,
  pages,
  pagesState,
  pageError,
  pending,
  formError,
  locked = false,
  onUpload,
  onSignOut,
}: {
  student: { rollNo: string; name: string };
  pages: ScriptPage[];
  pagesState: "loading" | "empty" | "error" | "ready";
  pageError?: string;
  pending: boolean;
  formError?: string;
  locked?: boolean;
  onUpload: (files: File[], replace: boolean) => void;
  onSignOut: () => void;
}) {
  const [error, setError] = useState("");
  const [replace, setReplace] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("page");
    const list = input instanceof HTMLInputElement ? input.files : null;
    const selected = list ? [...list].filter((file) => file.size > 0) : [];
    if (selected.length === 0) {
      setError("Choose at least one page.");
      return;
    }
    if (selected.length > LIMITS.maxPagesPerStudent) {
      setError(`A script can have at most ${LIMITS.maxPagesPerStudent} pages.`);
      return;
    }
    for (const file of selected) {
      if (file.size > LIMITS.maxFileBytes) {
        setError("Each page must be 6 MB or smaller.");
        return;
      }
      if (!PAGE_PATTERN.test(file.name)) {
        setError("Save the page as a JPG, PNG, WEBP, or PDF.");
        return;
      }
    }
    setError("");
    onUpload(selected, replace);
  }

  if (locked) {
    return (
      <section className="card">
        <h2>
          Uploading as {student.rollNo} · {student.name}
        </h2>
        <Banner tone="info">This script is locked. It has been validated, so the pages can no longer be changed.</Banner>
        <Button variant="quiet" onClick={onSignOut}>
          Not you?
        </Button>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>
        Uploading as {student.rollNo} · {student.name}
      </h2>
      <div className="actions">
        <Button variant="quiet" onClick={onSignOut}>
          Not you?
        </Button>
      </div>
      {formError ? <Banner tone="error">{formError}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="script-pages">Pages</label>
          <p id="script-pages-hint" className="hint">
            JPG, PNG, WEBP, or PDF. Up to {LIMITS.maxPagesPerStudent} pages, 6 MB each. iPhone HEIC photos need to be saved as JPG.
          </p>
          <input id="script-pages" name="page" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" multiple aria-describedby="script-pages-hint" />
        </div>
        <div className="check">
          <input id="replace-pages" type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
          <label htmlFor="replace-pages">Replace the pages already uploaded</label>
        </div>
        <Button type="submit" pending={pending}>
          {pending ? "Uploading…" : "Upload pages"}
        </Button>
      </form>
      <h3>Uploaded pages</h3>
      {pagesState === "loading" ? <LoadingBlock label="Loading uploaded pages…" /> : null}
      {pagesState === "error" ? <Banner tone="error">{pageError || "The uploaded pages could not be loaded."}</Banner> : null}
      {pagesState === "empty" || (pagesState === "ready" && pages.length === 0) ? (
        <EmptyState title="No pages yet">Upload a photo or scan of each answer sheet.</EmptyState>
      ) : null}
      {pagesState === "ready" && pages.length > 0 ? (
        <ul className="slip-list">
          {pages.map((page, index) => (
            <li key={page.id}>
              <span>
                Page {index + 1}: {page.filename}
              </span>
              {page.mime === "application/pdf" ? (
                <a href={page.url}>Open PDF</a>
              ) : (
                <img src={page.url} alt={`${page.filename}, page ${index + 1}`} style={{ maxWidth: "100%" }} />
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
