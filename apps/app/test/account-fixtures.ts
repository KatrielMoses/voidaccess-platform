// Fixtures for the account tests: a user with a full set of tenant rows.
import { randomUUID } from "node:crypto";
import { claimFoundingSeat } from "@voidaccess/db";
import {
  accounts,
  credentialVault,
  foundingNotices,
  invEntities,
  investigations,
  payments,
  runEvents,
  sessions,
  subscriptions,
} from "@voidaccess/db/schema";
import { db, makeUser } from "./helpers";

export async function makeRichUser() {
  const u = await makeUser({ credits: 500 });
  const invId = randomUUID();
  await db().withSystem("test.fixture", async (tx) => {
    await tx.insert(investigations).values({
      id: invId,
      userId: u.id,
      query: `query of ${u.id}`,
      depth: "quick",
      status: "completed",
      creditsCharged: 20,
    });
    await tx
      .insert(runEvents)
      .values({ runId: invId, userId: u.id, seq: 1, type: "stage", stage: "refine", at: new Date() });
    await tx.insert(invEntities).values({
      userId: u.id,
      investigationId: invId,
      bundleId: "e1",
      type: "actor",
      value: "x",
      displayValue: "x",
      confidence: 0.9,
    });
    await tx.insert(sessions).values({
      userId: u.id,
      token: "tok-" + u.id,
      expiresAt: new Date(Date.now() + 3_600_000),
      ipAddress: "203.0.113.9",
      userAgent: "vitest",
    });
    await tx
      .insert(accounts)
      .values({ userId: u.id, accountId: u.id, providerId: "credential", password: "hash-" + u.id });
    await tx.insert(credentialVault).values({
      userId: u.id,
      investigationId: invId,
      kind: "api_key",
      ciphertext: Buffer.from("c"),
      iv: Buffer.from("i"),
      authTag: Buffer.from("t"),
      wrappedDek: Buffer.from("w"),
      keyRef: "local:v1",
      maskedValue: "sk-****",
      fingerprint: "fp-" + u.id,
    });
    const [sub] = await tx
      .insert(subscriptions)
      .values({ userId: u.id, providerSubscriptionId: "sub_" + u.id, plan: "pro", status: "active" })
      .returning({ id: subscriptions.id });
    await tx.insert(payments).values({
      userId: u.id,
      providerPaymentId: "pay_" + u.id,
      amountCents: 900,
      kind: "subscription",
      subscriptionId: sub!.id,
      paidAt: new Date(),
    });
  });
  const seat = await claimFoundingSeat(u.id);
  return { user: u, invId, seat };
}

export async function releaseSeatRows(userId: string) {
  return db()
    .withSystem("test.fixture", (tx) => tx.select().from(foundingNotices), { audit: false })
    .then((r) => r.filter((n) => n.userId === userId));
}
