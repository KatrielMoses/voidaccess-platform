import { describe, expect, it, vi } from "vitest";
import { getAuth } from "@/lib/auth/auth";
import { cookieDomainCovers, corsOrigins, trustedOrigins } from "@/lib/auth/origins";
import { OPTIONS, POST } from "@/app/api/auth/[...all]/route";
import { db } from "./helpers";
import { eq } from "drizzle-orm";
import { users } from "@voidaccess/db/schema";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const SITE_DEV = "http://va.localhost:3700";

describe("cross-domain auth config (guarantee 2)", () => {
  it("production trusts exactly the app and the site; dev adds the local pairs", () => {
    expect(trustedOrigins("https://app.voidaccess.pro", "https://voidaccess.pro/", true)).toEqual([
      "https://app.voidaccess.pro",
      "https://voidaccess.pro",
    ]);
    const dev = trustedOrigins("http://app.va.localhost:3600", SITE_DEV, false);
    expect(dev).toContain("http://app.va.localhost:3600");
    expect(dev).toContain(SITE_DEV);
    expect(corsOrigins("https://voidaccess.pro", true)).toEqual(["https://voidaccess.pro"]);
  });

  it("the cookie domain must cover both hosts", () => {
    expect(
      cookieDomainCovers(".voidaccess.pro", ["https://app.voidaccess.pro", "https://voidaccess.pro"]),
    ).toBe(true);
    expect(cookieDomainCovers(".va.localhost", ["http://app.va.localhost:3600", SITE_DEV])).toBe(true);
    expect(cookieDomainCovers(".voidaccess.pro", ["https://voidaccess.pro.evil.com"])).toBe(false);
  });

  it("CORS on /api/auth: preflight and responses allow the site with credentials, nobody else", async () => {
    const pre = await OPTIONS(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "OPTIONS",
        headers: { origin: SITE_DEV },
      }),
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(SITE_DEV);
    expect(pre.headers.get("access-control-allow-credentials")).toBe("true");
    const evil = await OPTIONS(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    expect(evil.headers.get("access-control-allow-credentials")).toBeNull();
    // the app's own origin is not a CORS origin either (same-origin requests don't need it)
    const self = await OPTIONS(
      new Request("http://localhost:3000/x", {
        method: "OPTIONS",
        headers: { origin: "http://localhost:3000" },
      }),
    );
    expect(self.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("a cross-origin sign-up through the real route sets CORS headers and the AUP/first-touch land in the row", async () => {
    const email = `xd-${Date.now()}@test.local`;
    const res = await POST(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE_DEV, "x-forwarded-for": "10.9.9.9" },
        body: JSON.stringify({
          name: "Xd",
          email,
          password: "a long password",
          aupAccepted: true,
          callbackURL: "/welcome",
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE_DEV);
    const [u] = await db().withSystem("t", (tx) => tx.select().from(users).where(eq(users.email, email)), {
      audit: false,
    });
    expect(u?.aupAcceptedAt).toBeInstanceOf(Date);
  });

  it("callback URLs on untrusted origins are rejected (no open redirect)", async () => {
    const res = await getAuth().handler(
      new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE_DEV },
        body: JSON.stringify({ email: "x@test.local", callbackURL: "https://evil.example/" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
