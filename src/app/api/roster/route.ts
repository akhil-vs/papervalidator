import { ExamError } from "@/src/lib/errors";
import { LIMITS } from "@/src/lib/limits";
import { fail, json } from "@/src/lib/http";
import { studentsFromWorkbook } from "@/src/lib/sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ExamError(400, "Choose an .xlsx class list.");
    if (!file.name.toLowerCase().endsWith(".xlsx")) throw new ExamError(400, "Choose an .xlsx class list.");
    if (file.size > LIMITS.maxFileBytes) throw new ExamError(413, "That spreadsheet is too large.");
    const students = studentsFromWorkbook(new Uint8Array(await file.arrayBuffer()));
    return json({ students });
  } catch (error) {
    return fail(error);
  }
}
