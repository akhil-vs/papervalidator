import * as XLSX from "xlsx";
import { studentsFromSheet } from "./drafts";
import { ExamError } from "./errors";

export function studentsFromWorkbook(bytes: Uint8Array): { rollNo: string; name: string }[] {
  const book = XLSX.read(bytes, { type: "array" });
  const name = book.SheetNames[0];
  if (!name) throw new ExamError(400, "The spreadsheet is empty.");
  const matrix = XLSX.utils.sheet_to_json(book.Sheets[name], {
    header: 1,
    raw: false,
    defval: "",
  }) as unknown[][];
  const parsed = studentsFromSheet(matrix);
  if (parsed.error) throw new ExamError(400, parsed.error);
  return parsed.students;
}
