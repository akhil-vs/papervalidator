import React from "react";
import { formatMarks, sumCents, totalAwarded } from "@/src/lib/format";
import type { DeskExam, DeskStudent, Question } from "@/src/lib/types";

export function PrintSheet({
  exam,
  questions,
  student,
}: {
  exam: DeskExam;
  questions: Question[];
  student: DeskStudent;
}) {
  const maximum = sumCents(questions.map((question) => question.maxMarks));
  const obtained = totalAwarded(student.marks);
  return (
    <article className="sheet" aria-label="Validation sheet">
      <h1>{exam.title} validation result</h1>
      <p className="sheet-subject">{exam.subject}</p>
      <p className="sheet-total">{student.absent ? "Absent" : `${formatMarks(obtained ?? 0)} / ${formatMarks(maximum)}`}</p>
      <dl>
        <div>
          <dt>Name</dt>
          <dd>{student.name}</dd>
        </div>
        <div>
          <dt>Admission number</dt>
          <dd>{student.rollNo}</dd>
        </div>
        <div>
          <dt>Class</dt>
          <dd>{exam.className}</dd>
        </div>
        <div>
          <dt>Teacher</dt>
          <dd>{exam.teacherName}</dd>
        </div>
      </dl>
      {student.absent ? null : (
        <table>
          <caption className="sr-only">Marks and mistakes</caption>
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col">Mistakes</th>
              <th scope="col">Max marks</th>
              <th scope="col">Obtained marks</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((question) => {
              const mark = student.marks.find((item) => item.questionId === question.id);
              return (
                <tr key={question.id}>
                  <th scope="row">{question.label}</th>
                  <td>{mark?.comment?.trim() ? mark.comment : "—"}</td>
                  <td>{formatMarks(question.maxMarks)}</td>
                  <td>{mark?.awarded == null ? "—" : formatMarks(mark.awarded)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <h2>Other comments</h2>
      <p>{student.absent ? "Absent in the Exam" : student.note.trim() || "No other comments."}</p>
      <p className="sign">
        Teacher signature
        <span>{exam.teacherName}</span>
      </p>
    </article>
  );
}
