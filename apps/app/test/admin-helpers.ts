import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { auditLog, getDatabase, investigations, sessions, users } from "@voidaccess/db";
import { db, makeUser } from "./helpers";
import type { TestSessionUser } from "./session-state";

export const SAME_ORIGIN = { "sec-fetch-site": "same-origin", "content-type": "application/json" };

export async function makeAdmin(): Promise<TestSessionUser> {
  const u = await makeUser({ plan: "pro", credits: 0 });
  await db().withSystem(
    "test.makeAdmin",
    (tx) => tx.update(users).set({ role: "admin" }).where(eq(users.id, u.id)),
    {
      audit: false,
    },
  );
  return { ...u, role: "admin" };
}

/** audit_log rows for an action (newest first), optionally narrowed to a target. */
export async function audits(action: string, target?: string) {
  return db().withSystem(
    "test.audit",
    (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          target
            ? and(eq(auditLog.action, action), eq(auditLog.target, target))
            : eq(auditLog.action, action),
        )
        .orderBy(desc(auditLog.at)),
    { audit: false },
  );
}

export async function userRow(id: string) {
  const [r] = await db().withSystem("test.user", (tx) => tx.select().from(users).where(eq(users.id, id)), {
    audit: false,
  });
  return r!;
}

export async function addSession(userId: string) {
  await db().withSystem(
    "test.session",
    (tx) =>
      tx
        .insert(sessions)
        .values({ userId, token: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) }),
    { audit: false },
  );
}
export async function sessionCount(userId: string) {
  const rows = await db().withSystem(
    "test.sessions",
    (tx) => tx.select().from(sessions).where(eq(sessions.userId, userId)),
    {
      audit: false,
    },
  );
  return rows.length;
}

export async function addInvestigation(userId: string, o: Partial<typeof investigations.$inferInsert> = {}) {
  const id = randomUUID();
  await db().withSystem(
    "test.inv",
    (tx) =>
      tx.insert(investigations).values({
        id,
        userId,
        query: "test query " + id.slice(0, 4),
        depth: "standard",
        status: "completed",
        creditsCharged: 0,
        ...o,
      }),
    { audit: false },
  );
  return id;
}
export { getDatabase };
