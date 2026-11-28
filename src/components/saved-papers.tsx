"use client";

import React from "react";
import type { SavedDesk } from "@/src/lib/storage";
import { EmptyState } from "./ui";

export function SavedPapers({ papers, onOpen }: { papers: SavedDesk[]; onOpen: (key: string) => void }) {
  if (papers.length === 0) {
    return <EmptyState title="No papers on this browser yet">Papers you create here are listed on this device.</EmptyState>;
  }
  return (
    <ul className="saved">
      {papers.map((paper) => (
        <li key={paper.teacherKey}>
          <button type="button" onClick={() => onOpen(paper.teacherKey)}>
            <span>{paper.title}</span>
            <span className="muted">
              {paper.className} · {paper.subject}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
