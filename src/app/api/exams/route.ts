import { createExam } from "@/src/lib/exam";
import { fail, json, readJson } from "@/src/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return json(await createExam(await readJson(request)), 201);
  } catch (error) {
    return fail(error);
  }
}
