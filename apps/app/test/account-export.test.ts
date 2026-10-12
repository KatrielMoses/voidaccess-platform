import { describe, expect, it } from "vitest";
import { exportAccountData } from "@/lib/account/export";
import * as exportRoute from "@/app/api/account/export/route";
import { asUser, makeUser } from "./helpers";
import { makeRichUser } from "./account-fixtures";

describe("account export", () => {
  it("contains only the caller's own rows and no secrets", async () => {
    const a = await makeRichUser();
    const b = await makeRichUser();
    const data = await exportAccountData(a.user.id);
    const text = JSON.stringify(data);

    expect(data.user?.id).toBe(a.user.id);
    expect(data.investigations.map((i) => i.id)).toEqual([a.invId]);
    expect(data.runEvents).toHaveLength(1);
    expect(data.entities).toHaveLength(1);
    expect(data.creditLedger.length).toBeGreaterThan(0);
    expect(data.subscriptions).toHaveLength(1);
    expect(data.payments).toHaveLength(1);
    expect(data.foundingSeat).toHaveLength(1);
    for (const key of [
      "investigations",
      "runEvents",
      "entities",
      "creditLedger",
      "subscriptions",
      "payments",
      "sessions",
    ] as const) {
      for (const row of data[key] as Array<{ userId?: string }>)
        expect(row.userId === undefined || row.userId === a.user.id).toBe(true);
    }
    // nothing of user B, and no credentials/tokens
    expect(text).not.toContain(b.user.id);
    expect(text).not.toContain(b.user.email);
    expect(text).not.toContain("hash-" + a.user.id); // password hash
    expect(text).not.toContain("tok-" + a.user.id); // session token
    expect(text).not.toContain("sk-****"); // vault is not exported
  });

  it("GET /api/account/export returns a JSON attachment for the signed-in user, 401 otherwise", async () => {
    const u = await makeUser();
    asUser(null);
    expect((await exportRoute.GET()).status).toBe(401);
    asUser(u);
    const res = await exportRoute.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe(u.id);
  });
});
