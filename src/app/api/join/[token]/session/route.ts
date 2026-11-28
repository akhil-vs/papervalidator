import { openSession } from "@/src/lib/exam";
import { asRecord } from "@/src/lib/format";
import { fail, json, readJson } from "@/src/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { token } = await context.params;
    const body = asRecord(await readJson(request));
    const code = typeof body.code === "string" ? body.code : "";
    const studentId = typeof body.studentId === "string" && body.studentId ? body.studentId : undefined;
    return json(await openSession(token, code, studentId));
  } catch (error) {
    return fail(error);
  }
}
