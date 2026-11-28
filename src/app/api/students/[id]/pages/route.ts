import { addPage } from "@/src/lib/exam";
import { ExamError } from "@/src/lib/errors";
import { fail, json } from "@/src/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const form = await request.formData();
    const file = form.get("page");
    if (!(file instanceof File)) throw new ExamError(400, "Choose a page to upload.");
    const replace = new URL(request.url).searchParams.get("replace") === "1";
    const session = await addPage(
      id,
      request.headers.get("x-upload-code") ?? "",
      { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
      replace,
    );
    return json(session, 201);
  } catch (error) {
    return fail(error);
  }
}
