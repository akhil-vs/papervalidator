"use client";

import React, { useState } from "react";
import { scriptStatus } from "@/src/lib/format";
import type { DeskStudent } from "@/src/lib/types";
import { EmptyState, TextField } from "./ui";

export function StudentRail({
  students,
  selectedId,
  onSelect,
}: {
  students: DeskStudent[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = students.filter((student) => {
    if (!needle) return true;
    return student.name.toLowerCase().includes(needle) || student.rollNo.toLowerCase().includes(needle);
  });

  return (
    <div>
      <h2>Students</h2>
      <TextField id="student-search" label="Search students" value={query} onChange={setQuery} autoComplete="off" />
      {students.length === 0 ? (
        <EmptyState title="No students on this paper">Create the paper with a class list to start marking.</EmptyState>
      ) : null}
      {students.length > 0 && visible.length === 0 ? (
        <EmptyState title="No students match that search">Try another name or admission number.</EmptyState>
      ) : null}
      <ul className="rail">
        {visible.map((student) => {
          const selected = student.id === selectedId;
          return (
            <li key={student.id}>
              <button
                type="button"
                className={selected ? "rail-item is-selected" : "rail-item"}
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(student.id)}
              >
                <span>{student.name}</span>
                <span className="muted">{student.rollNo}</span>
                <span className="rail-status">{scriptStatus(student)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
