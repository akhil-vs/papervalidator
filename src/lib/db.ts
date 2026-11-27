import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
let pool: pg.Pool | undefined;
let local: Promise<PGlite> | undefined;
let localChain: Promise<unknown> = Promise.resolve();

export type Row = Record<string, unknown>;
export type Query = <T = Row>(text: string, params?: unknown[]) => Promise<T[]>;

export async function sql<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  if (databaseUrl !== "") {
    pool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
    return (await pool.query(text, params)).rows as T[];
  }
  return enqueue(() => localQuery<T>(text, params));
}

export async function withTransaction<T>(fn: (query: Query) => Promise<T>): Promise<T> {
  if (databaseUrl !== "") {
    pool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
    const client = await pool.connect();
    try {
      await client.query("begin");
      const query: Query = async (text, params = []) => (await client.query(text, params)).rows as Row[];
      const result = await fn(query);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  return enqueue(async () => {
    const db = await startLocal();
    await db.exec("begin");
    try {
      const query: Query = async <T = Row>(text: string, params: unknown[] = []) =>
        (await db.query<T>(text, params)).rows;
      const result = await fn(query);
      await db.exec("commit");
      return result;
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  });
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = localChain.then(fn, fn);
  localChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function localQuery<T>(text: string, params: unknown[]): Promise<T[]> {
  const db = await startLocal();
  return (await db.query<T>(text, params)).rows;
}

async function startLocal(): Promise<PGlite> {
  local ??= openLocal().catch((error: unknown) => {
    local = undefined;
    throw error;
  });
  return local;
}

async function openLocal(): Promise<PGlite> {
  const db = new PGlite();
  const files = (await readdir("migrations").catch(() => [])).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  return db;
}
