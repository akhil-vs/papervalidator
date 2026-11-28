import { ExamError } from "./errors";
import { LIMITS } from "./limits";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function fail(error: unknown): Response {
  if (error instanceof ExamError) return json({ error: error.message }, error.status);
  console.error(error);
  return json({ error: "Something went wrong. Try again." }, 500);
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > LIMITS.maxJsonBytes) throw new ExamError(413, "That request is too large.");
  if (!text.trim()) throw new ExamError(400, "The request body must be an object.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ExamError(400, "The request body must be an object.");
  }
}
