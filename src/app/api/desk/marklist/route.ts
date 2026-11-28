import { teacherKeyFrom } from "@/src/lib/auth";
import { buildMarklist } from "@/src/lib/exam";
import { ExamError } from "@/src/lib/errors";
import { fail } from "@/src/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const key = teacherKeyFrom(request);
    if (!key) throw new ExamError(401, "That teacher link does not match an exam.");
    const file = await buildMarklist(key);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${file.filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
