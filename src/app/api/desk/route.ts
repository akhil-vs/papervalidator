import { teacherKeyFrom } from "@/src/lib/auth";
import { loadDesk } from "@/src/lib/exam";
import { ExamError } from "@/src/lib/errors";
import { fail, json } from "@/src/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const key = teacherKeyFrom(request);
    if (!key) throw new ExamError(401, "That teacher link does not match an exam.");
    return json(await loadDesk(key));
  } catch (error) {
    return fail(error);
  }
}
