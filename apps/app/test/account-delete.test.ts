import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { APIError } from "better-auth/api";
import {
  accounts,
  auditLog,
  credentialVault,
  creditLedger,
  foundingNotices,
  foundingSeats,
  investigations,
  invEntities,
  payments,
  runEvents,
  sessions,
  subscriptions,
  users,
} from "@voidaccess/db/schema";
import { deleteAccount } from "@/lib/account/delete";
import * as deleteRoute from "@/app/api/account/delete/route";
import { getAuth } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { asUser, balanceOf, db, makeUser, sameOrigin } from "./helpers";
import { makeRichUser } from "./account-fixtures";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const count = async <T extends { userId: unknown }>(table: never, userId: string) =>
  (
    await db().withSystem(
      "test.count",
      (tx) =>
        tx
          .select()
          .from(table as never)
          .where(eq((table as unknown as T).userId as never, userId)),
      { audit: false },
    )
  ).length;

describe("account deletion", () => {
  it("removes tenant rows, anonymises the user, keeps the ledger, leaves other users alone", async () => {
    const a = await makeRichUser();
    const b = await makeRichUser();
    const ledgerBefore = await count(creditLedger as never, a.user.id);
    const balanceBefore = await balanceOf(a.user.id);
    expect(ledgerBefore).toBeGreaterThan(0);

    const res = await deleteAccount(a.user.id);
    expect(res?.investigationsDeleted).toBe(1);

    // tenant rows gone
    for (const t of [
      investigations,
      runEvents,
      invEntities,
      sessions,
      accounts,
      credentialVault,
      subscriptions,
      payments,
      foundingNotices,
    ]) {
      expect(await count(t as never, a.user.id)).toBe(0);
    }
    // founding seat released
    const seats = await db().withSystem(
      "test.seat",
      (tx) => tx.select().from(foundingSeats).where(eq(foundingSeats.seatNo, a.seat!)),
      { audit: false },
    );
    expect(seats[0]?.holderUserId).toBeNull();
    // ledger untouched
    expect(await count(creditLedger as never, a.user.id)).toBe(ledgerBefore);
    expect(await balanceOf(a.user.id)).toBe(balanceBefore);
    // user anonymised and unusable
    const [row] = await db().withSystem(
      "test.user",
      (tx) => tx.select().from(users).where(eq(users.id, a.user.id)),
      { audit: false },
    );
    expect(row).toMatchObject({
      email: `deleted-${a.user.id}@deleted.invalid`,
      name: "Deleted user",
      status: "banned",
      referralCode: null,
      firstTouch: null,
      profileRole: null,
      emailVerified: false,
    });
    asUser({ ...a.user, status: "banned" });
    await expect(requireUser()).rejects.toMatchObject({ status: 403 });
    // audit row
    const audit = await db().withSystem(
      "test.audit",
      (tx) =>
        tx
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.action, "account.delete"), eq(auditLog.target, a.user.id))),
      { audit: false },
    );
    expect(audit).toHaveLength(1);

    // user B untouched
    expect(await count(investigations as never, b.user.id)).toBe(1);
    expect(await count(sessions as never, b.user.id)).toBe(1);
    expect(await count(credentialVault as never, b.user.id)).toBe(1);
    expect(await count(subscriptions as never, b.user.id)).toBe(1);
    const [rowB] = await db().withSystem(
      "test.user",
      (tx) => tx.select().from(users).where(eq(users.id, b.user.id)),
      { audit: false },
    );
    expect(rowB?.email).toBe(b.user.email);
    expect(rowB?.status).toBe("active");
  });

  it("a deleted user can no longer sign in, even with the old password", async () => {
    const email = `del-${Date.now()}@test.local`;
    const password = "correct horse battery";
    const created = await getAuth().api.signUpEmail({ body: { name: "Del", email, password, aupAccepted: true } as never });
    await db().withSystem(
      "test.verify",
      (tx) => tx.update(users).set({ emailVerified: true }).where(eq(users.id, created.user.id)),
      { audit: false },
    );
    const ok = await getAuth().api.signInEmail({ body: { email, password } });
    expect(ok.user.id).toBe(created.user.id);

    await deleteAccount(created.user.id);
    await expect(getAuth().api.signInEmail({ body: { email, password } })).rejects.toBeInstanceOf(APIError);
  });

  describe("POST /api/account/delete", () => {
    const post = (confirm: string, headers: Record<string, string> = sameOrigin) =>
      deleteRoute.POST(
        new Request("http://localhost:3000/api/account/delete", {
          method: "POST",
          headers,
          body: JSON.stringify({ confirm }),
        }),
      );

    it("requires sign-in, same origin and the typed email", async () => {
      const u = await makeUser();
      asUser(null);
      expect((await post(u.email)).status).toBe(401);
      asUser(u);
      expect((await post(u.email, { "content-type": "application/json" })).status).toBe(403); // no origin proof
      expect((await post("nope")).status).toBe(400);
      const [still] = await db().withSystem("t", (tx) => tx.select().from(users).where(eq(users.id, u.id)), {
        audit: false,
      });
      expect(still?.status).toBe("active");
      expect((await post(u.email.toUpperCase())).status).toBe(200);
      const [gone] = await db().withSystem("t", (tx) => tx.select().from(users).where(eq(users.id, u.id)), {
        audit: false,
      });
      expect(gone?.status).toBe("banned");
    });
  });
});
