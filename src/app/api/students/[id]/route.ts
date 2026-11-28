import { teacherKeyFrom } from "@/src/lib/auth";
import { updateStudent } from "@/src/lib/exam";
import { ExamError } from "@/src/lib/errors";
import { fail, json, readJson } from "@/src/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const key = teacherKeyFrom(request);
    if (!key) throw new ExamError(401, "That teacher link does not match an exam.");
    const { id } = await context.params;
    return json(await updateStudent(key, id, await readJson(request)));
  } catch (error) {
    return fail(error);
  }
}
