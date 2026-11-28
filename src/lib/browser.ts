export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error("The server could not be reached. Check your connection and try again.");
  }
  if (!response.ok) {
    let message = "Something went wrong. Try again.";
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) message = body.error;
    } catch {
      message = "Something went wrong. Try again.";
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function apiBlob(path: string, init?: RequestInit): Promise<{ blob: Blob; filename: string }> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error("The server could not be reached. Check your connection and try again.");
  }
  if (!response.ok) {
    let message = "Something went wrong. Try again.";
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) message = body.error;
    } catch {
      message = "Something went wrong. Try again.";
    }
    throw new Error(message);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  return { blob: await response.blob(), filename: match?.[1] || "download" };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
