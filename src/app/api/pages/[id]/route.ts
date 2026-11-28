import { teacherKeyFrom } from "@/src/lib/auth";
import { readPage } from "@/src/lib/exam";
import { fail } from "@/src/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const page = await readPage(id, {
      teacherKey: teacherKeyFrom(request),
      uploadCode: request.headers.get("x-upload-code"),
    });
    const filename = page.filename.replace(/"/g, "");
    return new Response(Buffer.from(page.bytes), {
      headers: {
        "content-type": page.mime,
        "content-disposition": `inline; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
