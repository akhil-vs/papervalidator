import { loadPublicExam } from "@/src/lib/exam";
import { fail, json } from "@/src/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { token } = await context.params;
    return json(await loadPublicExam(token));
  } catch (error) {
    return fail(error);
  }
}
