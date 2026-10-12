import { and, eq, gte, sql } from "drizzle-orm";
import { waitlist, type FirstTouch } from "@voidaccess/db/schema";
import type { Db } from "./db";

export interface NewEntry {
  email: string;
  role?: string;
  useCase?: string;
  wantsFounding: boolean;
  consentMarketing: boolean;
  refCode?: string;
  firstTouch: FirstTouch;
  ipHash: string;
  confirmTokenHash: string;
}

export interface ExistingEntry {
  confirmed: boolean;
}

export interface WaitlistStore {
  /** Inserts a row; returns false (and writes nothing) if the email already exists. */
  insertIfNew(entry: NewEntry): Promise<boolean>;
  find(email: string): Promise<ExistingEntry | null>;
  /** For an existing, unconfirmed email: store a fresh token and merge newly stated interest. */
  refreshToken(email: string, confirmTokenHash: string, merge: { wantsFounding: boolean; consentMarketing: boolean }): Promise<void>;
  countRecentByIp(ipHash: string, since: Date): Promise<number>;
  confirm(tokenHash: string): Promise<"confirmed" | "already" | "invalid">;
}

export function drizzleStore(db: Db): WaitlistStore {
  return {
    async insertIfNew(e) {
      const rows = await db
        .insert(waitlist)
        .values({
          email: e.email,
          role: e.role,
          useCase: e.useCase,
          wantsFounding: e.wantsFounding,
          consentMarketing: e.consentMarketing,
          refCode: e.refCode,
          firstTouch: e.firstTouch,
          ipHash: e.ipHash,
          confirmTokenHash: e.confirmTokenHash,
        })
        .onConflictDoNothing()
        .returning({ id: waitlist.id });
      return rows.length > 0;
    },
    async find(email) {
      const [row] = await db
        .select({ confirmedAt: waitlist.confirmedAt })
        .from(waitlist)
        .where(sql`lower(${waitlist.email}) = ${email.toLowerCase()}`)
        .limit(1);
      return row ? { confirmed: row.confirmedAt !== null } : null;
    },
    async refreshToken(email, hash, merge) {
      await db
        .update(waitlist)
        .set({
          confirmTokenHash: hash,
          wantsFounding: sql`${waitlist.wantsFounding} OR ${merge.wantsFounding}`,
          consentMarketing: sql`${waitlist.consentMarketing} OR ${merge.consentMarketing}`,
        })
        .where(and(sql`lower(${waitlist.email}) = ${email.toLowerCase()}`, sql`${waitlist.confirmedAt} IS NULL`));
    },
    async countRecentByIp(ipHash, since) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(waitlist)
        .where(and(eq(waitlist.ipHash, ipHash), gte(waitlist.createdAt, since)));
      return row?.n ?? 0;
    },
    async confirm(tokenHash) {
      const [row] = await db
        .select({ id: waitlist.id, confirmedAt: waitlist.confirmedAt })
        .from(waitlist)
        .where(eq(waitlist.confirmTokenHash, tokenHash))
        .limit(1);
      if (!row) return "invalid";
      if (row.confirmedAt) return "already";
      await db.update(waitlist).set({ confirmedAt: new Date() }).where(and(eq(waitlist.id, row.id), sql`${waitlist.confirmedAt} IS NULL`));
      return "confirmed";
    },
  };
}

/** In-memory store for unit tests. */
export function memoryStore(): WaitlistStore & { rows: (NewEntry & { confirmedAt?: Date; createdAt: Date })[] } {
  const rows: (NewEntry & { confirmedAt?: Date; createdAt: Date })[] = [];
  return {
    rows,
    async insertIfNew(e) {
      if (rows.some((r) => r.email.toLowerCase() === e.email.toLowerCase())) return false;
      rows.push({ ...e, createdAt: new Date() });
      return true;
    },
    async find(email) {
      const r = rows.find((x) => x.email.toLowerCase() === email.toLowerCase());
      return r ? { confirmed: !!r.confirmedAt } : null;
    },
    async refreshToken(email, hash, merge) {
      const r = rows.find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (r && !r.confirmedAt) {
        r.confirmTokenHash = hash;
        r.wantsFounding ||= merge.wantsFounding;
        r.consentMarketing ||= merge.consentMarketing;
      }
    },
    async countRecentByIp(ipHash, since) {
      return rows.filter((r) => r.ipHash === ipHash && r.createdAt >= since).length;
    },
    async confirm(hash) {
      const r = rows.find((x) => x.confirmTokenHash === hash);
      if (!r) return "invalid";
      if (r.confirmedAt) return "already";
      r.confirmedAt = new Date();
      return "confirmed";
    },
  };
}
