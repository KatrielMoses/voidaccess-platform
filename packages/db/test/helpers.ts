import pg from "pg";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "../src/client";
import { users } from "../src/schema";
import type { PlanId } from "@voidaccess/config";
import { appUrl, ownerUrl } from "./urls";

let app: Database | undefined;
let owner: pg.Pool | undefined;

/** Database connected as va_app (RLS applies). */
export function appDb(): Database {
  return (app ??= createDatabase(appUrl, { max: 30 }));
}
/** Superuser pool on the test database, for inspection only. */
export function ownerPool(): pg.Pool {
  return (owner ??= new pg.Pool({ connectionString: ownerUrl, max: 3 }));
}

export async function makeUser(plan: PlanId = "pro", over: Partial<typeof users.$inferInsert> = {}) {
  const id = randomUUID();
  await appDb().withSystem("test.makeUser", (tx) =>
    tx.insert(users).values({ id, name: "Test " + id.slice(0, 4), email: `${id}@test.local`, plan, ...over }),
  );
  return id;
}

/** Drizzle wraps driver errors ("Failed query"); this digs out the Postgres message and code. */
export async function pgError(p: Promise<unknown>): Promise<{ message: string; code?: string }> {
  try {
    await p;
  } catch (e) {
    let cur: unknown = e;
    let last = e as { message?: string; code?: string };
    while (cur && typeof cur === "object") {
      last = cur as typeof last;
      cur = (cur as { cause?: unknown }).cause;
    }
    return { message: String(last.message), code: last.code };
  }
  throw new Error("expected the query to fail, but it succeeded");
}
