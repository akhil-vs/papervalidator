import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDom } from "./dom";

const questions = [
  { id: "q1", position: 1, label: "1", maxMarks: 5 },
  { id: "q2", position: 2, label: "2", maxMarks: 10 },
];

const meera = {
  id: "s1",
  rollNo: "1401",
  name: "Meera",
  uploadCode: "AB3K7PQM",
  absent: false,
  validatedAt: null,
  note: "Neat work",
  pages: [],
  marks: [
    { questionId: "q1", awarded: 4.5, comment: "sign error" },
    { questionId: "q2", awarded: 8, comment: "" },
  ],
};

const rohan = {
  ...meera,
  id: "s2",
  rollNo: "1402",
  name: "Rohan",
  absent: true,
  note: "",
  marks: [
    { questionId: "q1", awarded: null, comment: "" },
    { questionId: "q2", awarded: null, comment: "" },
  ],
};

const exam = {
  id: "exam",
  title: "Midterm",
  className: "10 A",
  subject: "Mathematics",
  teacherName: "Meera Nair",
  studentToken: "token",
  createdAt: "2026-11-28T00:00:00.000Z",
};

test("marking screens", async (t) => {
  setupDom();
  const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
  const { ExamForm } = await import("../src/components/exam-form");
  const { MarkForm } = await import("../src/components/mark-form");
  const { StudentRail } = await import("../src/components/student-rail");
  const { ScriptPanel } = await import("../src/components/script-panel");
  const { PrintSheet } = await import("../src/components/print-sheet");
  const { CodeForm } = await import("../src/components/code-form");
  const { UploadPanel } = await import("../src/components/upload-panel");
  const { SavedPapers } = await import("../src/components/saved-papers");
  const { TextField } = await import("../src/components/ui");

  async function check(name: string, run: () => void) {
    await t.test(name, () => {
      try {
        run();
      } finally {
        cleanup();
      }
    });
  }

  await check("exam form blocks an empty paper and accepts the sample class", () => {
    let created = 0;
    render(<ExamForm onCreate={() => { created += 1; }} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Create paper" }));
    assert.match(screen.getByRole("alert").textContent ?? "", /highlighted fields/);
    assert.match(screen.getByText("Exam name is required.").textContent ?? "", /required/);
    const title = screen.getByLabelText(/Exam name/) as HTMLInputElement;
    assert.equal(title.getAttribute("aria-invalid"), "true");
    assert.equal(created, 0);

    fireEvent.click(screen.getByRole("button", { name: "Fill a sample class" }));
    fireEvent.click(screen.getByRole("button", { name: "Create paper" }));
    assert.equal(created, 1);
  });

  await check("mark form validates before save and allows a blank save", () => {
    const calls: string[] = [];
    const draft = {
      absent: false,
      note: "",
      marks: [
        { questionId: "q1", awarded: "", comment: "" },
        { questionId: "q2", awarded: "", comment: "" },
      ],
    };
    render(
      <MarkForm
        studentName="Meera"
        questions={questions}
        draft={draft}
        onChange={() => undefined}
        validated={false}
        pending={false}
        onSubmit={(_draft, intent) => calls.push(intent)}
        onReopen={() => calls.push("reopen")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Validate paper" }));
    assert.match(screen.getByText("Enter marks for question 1.").textContent ?? "", /question 1/);
    assert.deepEqual(calls, []);
    fireEvent.click(screen.getByRole("button", { name: "Save marks" }));
    assert.deepEqual(calls, ["save"]);
  });

  await check("mark form rejects marks above the maximum", () => {
    const calls: string[] = [];
    render(
      <MarkForm
        studentName="Meera"
        questions={questions}
        draft={{
          absent: false,
          note: "",
          marks: [
            { questionId: "q1", awarded: "9", comment: "" },
            { questionId: "q2", awarded: "1", comment: "" },
          ],
        }}
        onChange={() => undefined}
        validated={false}
        pending={false}
        onSubmit={() => calls.push("save")}
        onReopen={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save marks" }));
    assert.match(screen.getByText(/cannot be above 5/).textContent ?? "", /5/);
    assert.deepEqual(calls, []);
  });

  await check("student list shows status words and an empty search", () => {
    render(<StudentRail students={[meera, rohan]} selectedId="s1" onSelect={() => undefined} />);
    assert.match(screen.getByRole("button", { name: /Meera/ }).textContent ?? "", /No script/);
    assert.match(screen.getByRole("button", { name: /Rohan/ }).textContent ?? "", /Marked absent/);
    fireEvent.change(screen.getByLabelText("Search students"), { target: { value: "zzz" } });
    assert.match(screen.getByRole("heading", { name: "No students match that search" }).textContent ?? "", /search/);
  });

  await check("script panel shows empty and error states", () => {
    const empty = render(<ScriptPanel state="empty" pages={[]} />);
    assert.match(screen.getByRole("heading", { name: "No answer sheets yet" }).textContent ?? "", /answer sheets/);
    empty.unmount();
    render(<ScriptPanel state="error" pages={[]} error="The script could not be loaded." />);
    assert.equal(screen.getByRole("alert").textContent, "The script could not be loaded.");
  });

  await check("print sheet hides the question table when the student is absent", () => {
    const view = render(<PrintSheet exam={exam} questions={questions} student={rohan} />);
    assert.equal(screen.queryByRole("table"), null);
    assert.match(view.container.textContent ?? "", /Absent in the Exam/);
    view.unmount();
    render(<PrintSheet exam={exam} questions={questions} student={meera} />);
    assert.match(screen.getByRole("table").textContent ?? "", /sign error/);
    assert.match(screen.getByRole("table").textContent ?? "", /4\.5/);
  });

  await check("upload code form and empty upload both stop before the server", () => {
    let submitted = "";
    render(
      <CodeForm
        students={[{ id: "s1", rollNo: "1401", name: "Meera" }]}
        pending={false}
        onSubmit={(code) => {
          submitted = code;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    assert.match(screen.getByRole("alert").textContent ?? "", /8-character code/);
    assert.equal(submitted, "");
    cleanup();

    let uploaded = 0;
    render(
      <UploadPanel
        student={{ rollNo: "1401", name: "Meera" }}
        pages={[]}
        pagesState="empty"
        pending={false}
        onUpload={() => {
          uploaded += 1;
        }}
        onSignOut={() => undefined}
      />,
    );
    assert.match(screen.getByRole("heading", { name: "No pages yet" }).textContent ?? "", /pages/);
    fireEvent.click(screen.getByRole("button", { name: "Upload pages" }));
    assert.match(screen.getByRole("alert").textContent ?? "", /at least one page/);
    assert.equal(uploaded, 0);
    cleanup();

    render(
      <UploadPanel
        student={{ rollNo: "1401", name: "Meera" }}
        pages={[]}
        pagesState="empty"
        pending={false}
        locked
        onUpload={() => {
          uploaded += 1;
        }}
        onSignOut={() => undefined}
      />,
    );
    assert.match(screen.getByRole("status").textContent ?? "", /script is locked/);
    assert.equal(screen.queryByRole("button", { name: "Upload pages" }), null);
    assert.equal(uploaded, 0);
  });

  await check("saved papers and fields expose empty and invalid states", () => {
    const empty = render(<SavedPapers papers={[]} onOpen={() => undefined} />);
    assert.match(empty.container.textContent ?? "", /No papers on this browser yet/);
    empty.unmount();
    render(<TextField id="teacher" label="Teacher" value="" onChange={() => undefined} error="Teacher is required." required />);
    const field = screen.getByLabelText(/Teacher/) as HTMLInputElement;
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.equal(field.getAttribute("aria-describedby"), "teacher-error");
  });
});
