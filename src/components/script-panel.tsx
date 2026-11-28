"use client";

import React, { useEffect, useState } from "react";
import { Banner, Button, EmptyState, LoadingBlock } from "./ui";

export type ScriptPage = { id: string; filename: string; mime: string; url: string };

export function ScriptPanel({
  state,
  pages,
  error,
}: {
  state: "loading" | "empty" | "error" | "ready";
  pages: ScriptPage[];
  error?: string;
}) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    setIndex(0);
    setZoom(1);
  }, [pages]);

  if (state === "loading") return <LoadingBlock label="Loading the script…" />;
  if (state === "error") return <Banner tone="error">{error || "The script could not be loaded."}</Banner>;
  if (state === "empty" || pages.length === 0) {
    return <EmptyState title="No answer sheets yet">When the student uploads a page, it will show here.</EmptyState>;
  }

  const page = pages[Math.min(index, pages.length - 1)];
  const label = `${page.filename}, page ${index + 1} of ${pages.length}`;

  return (
    <div>
      <h2>Script</h2>
      <div className="script-toolbar actions">
        <Button variant="secondary" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0}>
          Previous page
        </Button>
        <Button
          variant="secondary"
          onClick={() => setIndex((value) => Math.min(pages.length - 1, value + 1))}
          disabled={index >= pages.length - 1}
        >
          Next page
        </Button>
        <Button variant="quiet" onClick={() => setZoom((value) => Math.max(0.5, Math.round((value - 0.25) * 100) / 100))} aria-label="Zoom out">
          Zoom out
        </Button>
        <Button variant="quiet" onClick={() => setZoom((value) => Math.min(3, Math.round((value + 0.25) * 100) / 100))} aria-label="Zoom in">
          Zoom in
        </Button>
        <span className="muted" aria-live="polite">
          {label}
        </span>
      </div>
      <div className="script-frame">
        {page.mime === "application/pdf" ? (
          <iframe title={label} src={page.url} />
        ) : (
          <img className="script-image" alt={label} src={page.url} style={{ width: `${zoom * 100}%` }} />
        )}
      </div>
    </div>
  );
}
