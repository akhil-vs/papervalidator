import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("teacher desk, student upload, and mark list", async () => {
  delete process.env.DATABASE_URL;
  const exams = await import("../src/app/api/exams/route");
  const desk = await import("../src/app/api/desk/route");
  const marklist = await import("../src/app/api/desk/marklist/route");
  const students = await import("../src/app/api/students/[id]/route");
  const pages = await import("../src/app/api/students/[id]/pages/route");
  const pageFile = await import("../src/app/api/pages/[id]/route");
  const join = await import("../src/app/api/join/[token]/route");
  const session = await import("../src/app/api/join/[token]/session/route");
  const roster = await import("../src/app/api/roster/route");
  const { LIMITS } = await import("../src/lib/limits");

  const missing = await exams.POST(new Request("http://localhost/api/exams", { method: "POST", body: "{}" }));
  assert.equal(missing.status, 400);
  assert.match(((await missing.json()) as { error: string }).error, /Exam name is required/);

  const createdResponse = await exams.POST(
    new Request("http://localhost/api/exams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Midterm",
        className: "10 A",
        subject: "Mathematics",
        teacherName: "Meera Nair",
        questions: [
          { label: "1", maxMarks: 5 },
          { label: "2", maxMarks: 10 },
        ],
        students: [
          { rollNo: "1402", name: "Rohan" },
          { rollNo: "1401", name: "Meera" },
        ],
      }),
    }),
  );
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()) as { teacherKey: string; studentToken: string };
  assert.equal(typeof created.teacherKey, "string");

  const deskResponse = await desk.GET(new Request("http://localhost/api/desk", { headers: { "x-teacher-key": created.teacherKey } }));
  assert.equal(deskResponse.status, 200);
  const loaded = (await deskResponse.json()) as {
    exam: { studentToken: string };
    questions: { id: string; label: string }[];
    students: { id: string; name: string; rollNo: string; uploadCode: string; pages: unknown[] }[];
  };
  assert.deepEqual(
    loaded.students.map((student) => student.rollNo),
    ["1401", "1402"],
  );
  const meera = loaded.students[0];
  const rohan = loaded.students[1];
  assert.equal(JSON.stringify(created).includes(meera.uploadCode), false);

  const denied = await desk.GET(new Request("http://localhost/api/desk", { headers: { "x-teacher-key": "not-a-key" } }));
  assert.equal(denied.status, 401);

  const publicExam = await join.GET(new Request("http://localhost/api/join/token"), { params: Promise.resolve({ token: created.studentToken }) });
  assert.equal(publicExam.status, 200);
  const publicBody = await publicExam.text();
  assert.equal(publicBody.includes(meera.uploadCode), false);
  assert.equal(publicBody.includes("uploadCode"), false);

  const wrong = await session.POST(
    new Request("http://localhost/api/join/token/session", {
      method: "POST",
      body: JSON.stringify({ code: "00000000" }),
    }),
    { params: Promise.resolve({ token: created.studentToken }) },
  );
  assert.equal(wrong.status, 401);

  const opened = await session.POST(
    new Request("http://localhost/api/join/token/session", {
      method: "POST",
      body: JSON.stringify({ code: meera.uploadCode, studentId: meera.id }),
    }),
    { params: Promise.resolve({ token: created.studentToken }) },
  );
  assert.equal(opened.status, 200);

  const form = new FormData();
  form.set("page", new File([png], "page.png", { type: "image/png" }));
  const uploaded = await pages.POST(
    new Request(`http://localhost/api/students/${meera.id}/pages`, {
      method: "POST",
      headers: { "x-upload-code": meera.uploadCode },
      body: form,
    }),
    { params: Promise.resolve({ id: meera.id }) },
  );
  assert.equal(uploaded.status, 201);
  const withPage = (await uploaded.json()) as { pages: { id: string }[] };
  assert.equal(withPage.pages.length, 1);

  const image = await pageFile.GET(new Request(`http://localhost/api/pages/${withPage.pages[0].id}`, { headers: { "x-teacher-key": created.teacherKey } }), {
    params: Promise.resolve({ id: withPage.pages[0].id }),
  });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await image.arrayBuffer()).length, png.length);
  const hidden = await pageFile.GET(new Request(`http://localhost/api/pages/${withPage.pages[0].id}`), {
    params: Promise.resolve({ id: withPage.pages[0].id }),
  });
  assert.equal(hidden.status, 401);

  const tooHigh = await students.PATCH(
    new Request(`http://localhost/api/students/${meera.id}`, {
      method: "PATCH",
      headers: { "x-teacher-key": created.teacherKey, "content-type": "application/json" },
      body: JSON.stringify({
        absent: false,
        note: "",
        validate: false,
        marks: [
          { questionId: loaded.questions[0].id, awarded: "9", comment: "" },
          { questionId: loaded.questions[1].id, awarded: "1", comment: "" },
        ],
      }),
    }),
    { params: Promise.resolve({ id: meera.id }) },
  );
  assert.equal(tooHigh.status, 400);

  const saved = await students.PATCH(
    new Request(`http://localhost/api/students/${meera.id}`, {
      method: "PATCH",
      headers: { "x-teacher-key": created.teacherKey, "content-type": "application/json" },
      body: JSON.stringify({
        absent: false,
        note: "Checked working.",
        validate: true,
        marks: [
          { questionId: loaded.questions[0].id, awarded: "4.5", comment: "sign error" },
          { questionId: loaded.questions[1].id, awarded: "8", comment: "" },
        ],
      }),
    }),
    { params: Promise.resolve({ id: meera.id }) },
  );
  assert.equal(saved.status, 200);
  const marked = (await saved.json()) as {
    students: { id: string; validatedAt: string | null; marks: { awarded: number | null; comment: string }[] }[];
  };
  const savedMeera = marked.students.find((student) => student.id === meera.id);
  assert.ok(savedMeera?.validatedAt);
  assert.equal(savedMeera?.marks[0].awarded, 4.5);
  assert.equal(savedMeera?.marks[0].comment, "sign error");

  const lockedUpload = new FormData();
  lockedUpload.set("page", new File([png], "again.png", { type: "image/png" }));
  const locked = await pages.POST(
    new Request(`http://localhost/api/students/${meera.id}/pages`, {
      method: "POST",
      headers: { "x-upload-code": meera.uploadCode },
      body: lockedUpload,
    }),
    { params: Promise.resolve({ id: meera.id }) },
  );
  assert.equal(locked.status, 409);

  for (let index = 0; index < LIMITS.maxPagesPerStudent; index += 1) {
    const body = new FormData();
    body.set("page", new File([png], `r${index}.png`, { type: "image/png" }));
    const response = await pages.POST(
      new Request(`http://localhost/api/students/${rohan.id}/pages`, {
        method: "POST",
        headers: { "x-upload-code": rohan.uploadCode },
        body,
      }),
      { params: Promise.resolve({ id: rohan.id }) },
    );
    assert.equal(response.status, 201);
  }
  const extra = new FormData();
  extra.set("page", new File([png], "extra.png", { type: "image/png" }));
  const overflow = await pages.POST(
    new Request(`http://localhost/api/students/${rohan.id}/pages`, {
      method: "POST",
      headers: { "x-upload-code": rohan.uploadCode },
      body: extra,
    }),
    { params: Promise.resolve({ id: rohan.id }) },
  );
  assert.equal(overflow.status, 400);

  const absent = await students.PATCH(
    new Request(`http://localhost/api/students/${rohan.id}`, {
      method: "PATCH",
      headers: { "x-teacher-key": created.teacherKey, "content-type": "application/json" },
      body: JSON.stringify({
        absent: true,
        note: "",
        validate: true,
        marks: loaded.questions.map((question) => ({ questionId: question.id, awarded: null, comment: "" })),
      }),
    }),
    { params: Promise.resolve({ id: rohan.id }) },
  );
  assert.equal(absent.status, 200);

  const list = await marklist.GET(new Request("http://localhost/api/desk/marklist", { headers: { "x-teacher-key": created.teacherKey } }));
  assert.equal(list.status, 200);
  assert.match(list.headers.get("content-disposition") ?? "", /mathematics-10-a\.xlsx/);
  const book = XLSX.read(Buffer.from(await list.arrayBuffer()));
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets[book.SheetNames[0]], { header: 1 });
  assert.deepEqual(rows[0], ["SlNo", "AdmNo", "Name", "Marks"]);
  assert.deepEqual(rows[1], [1, "1401", "Meera", 12.5]);
  assert.deepEqual(rows[2], [2, "1402", "Rohan", "Absent"]);

  const sheet = XLSX.utils.aoa_to_sheet([
    ["SlNo", "AdmNo", "Name"],
    [1, "15", "Ada"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Class");
  const xlsx = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const rosterForm = new FormData();
  rosterForm.set("file", new File([new Uint8Array(xlsx)], "class.xlsx"));
  const rosterResponse = await roster.POST(new Request("http://localhost/api/roster", { method: "POST", body: rosterForm }));
  assert.equal(rosterResponse.status, 200);
  assert.deepEqual(await rosterResponse.json(), { students: [{ rollNo: "15", name: "Ada" }] });

  const badBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(badBook, XLSX.utils.aoa_to_sheet([["Name"], ["Ada"]]), "Class");
  const badForm = new FormData();
  badForm.set("file", new File([new Uint8Array(XLSX.write(badBook, { type: "buffer", bookType: "xlsx" }) as Buffer)], "bad.xlsx"));
  const badRoster = await roster.POST(new Request("http://localhost/api/roster", { method: "POST", body: badForm }));
  assert.equal(badRoster.status, 400);

  const second = await exams.POST(
    new Request("http://localhost/api/exams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Quiz",
        className: "9 B",
        subject: "Science",
        teacherName: "Isha",
        questions: [{ label: "1", maxMarks: 2 }],
        students: [{ rollNo: "1", name: "Lila" }],
      }),
    }),
  );
  const quiz = (await second.json()) as { studentToken: string };
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const failure = await session.POST(
      new Request("http://localhost/api/join/quiz/session", { method: "POST", body: JSON.stringify({ code: "00000000" }) }),
      { params: Promise.resolve({ token: quiz.studentToken }) },
    );
    assert.equal(failure.status, 401);
  }
  const limited = await session.POST(
    new Request("http://localhost/api/join/quiz/session", { method: "POST", body: JSON.stringify({ code: "00000000" }) }),
    { params: Promise.resolve({ token: quiz.studentToken }) },
  );
  assert.equal(limited.status, 429);
});
