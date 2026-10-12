import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RunSpec } from "@voidaccess/engine-client";
import { setLauncher } from "@/lib/launcher";
import * as bundleRoute from "@/app/api/engine/runs/[id]/artifacts/bundle/route";
import * as watchdogRoute from "@/app/api/cron/watchdog/route";
import { verifyGoogleOidc } from "@/lib/runs/cron-auth";
import { deriveArtifactToken, deriveCallbackSecret } from "@/lib/runs/secrets";
import { startInvestigation } from "@/lib/runs/service";
import { APP, StubLauncher, call, ctxFor, makeUser, patchRun, postEvent, runRow } from "./helpers";

const stub = new StubLauncher();
setLauncher(stub);
const QUERY = "super secret query: Cl0p MOVEit";

async function run() {
  const u = await makeUser();
  const r = await startInvestigation(u, { query: QUERY, depth: "quick" });
  const req = stub.launches.find((l) => l.runId === r.id)!;
  const token = new URL(req.specUrl).searchParams.get("t")!;
  return { u, id: r.id, req, token };
}

describe("spec endpoint and the engine boundary", () => {
  it("never puts the query in launcher args; the spec URL is the only handle", async () => {
    const { req } = await run();
    expect(JSON.stringify(req)).not.toContain("secret query");
    expect(JSON.stringify(req)).not.toContain(encodeURIComponent("secret"));
    expect(Object.keys(req).sort()).toEqual(["deadlineAt", "runId", "specUrl"]);
  });

  it("the spec is single-use: first fetch returns the RunSpec, the second is 404", async () => {
    const { id, token } = await run();
    const first = await call.spec(id, token);
    expect(first.status).toBe(200);
    const spec = RunSpec.parse(await first.json());
    expect(spec.query).toBe(QUERY);
    expect(spec.run_id).toBe(id);
    expect(spec.callback_secret).toBe(deriveCallbackSecret(id));
    expect(spec.callback_url).toBe(`${APP}/api/engine/runs/${id}/events`);
    expect(new Date(spec.deadline_at).getTime()).toBeGreaterThan(Date.now());
    const second = await call.spec(id, token);
    expect(second.status).toBe(404);
    // the callback secret from the spec works
    expect(
      (
        await postEvent(
          id,
          1,
          { type: "stage", stage: "refine", status: "start" },
          { secret: spec.callback_secret },
        )
      ).status,
    ).toBe(200);
  });

  it("wrong token, no token, unknown run, other run's token and expired token are all the same 404", async () => {
    const a = await run();
    const b = await run();
    const bodies: string[] = [];
    for (const res of [
      await call.spec(a.id, "wrong-token"),
      await call.spec(a.id),
      await call.spec(a.id, ""),
      await call.spec("00000000-0000-4000-8000-000000000000", a.token),
      await call.spec("not-a-uuid", a.token),
      await call.spec(a.id, b.token), // another run's token
    ]) {
      expect(res.status).toBe(404);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1); // identical body: existence is never revealed
    // a failed attempt does not burn the real token
    // expired: push the expiry into the past
    await patchRun(a.id, { specTokenExpiresAt: new Date(Date.now() - 1000) });
    expect((await call.spec(a.id, a.token)).status).toBe(404);
    expect((await call.spec(b.id, b.token)).status).toBe(200);
  });

  it("the token is stored only as sha256, expires within 10 minutes, and is not usable once the run is terminal", async () => {
    const { id, token } = await run();
    const row = (await runRow(id))!;
    expect(row.specTokenHash).not.toBe(token);
    expect(row.specTokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(token);
    const ttl = row.specTokenExpiresAt!.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);
    expect(row.specTokenUsedAt).toBeNull();
    await postEvent(id, 1, { type: "failed", reason: "error", stages_completed: [] });
    expect((await call.spec(id, token)).status).toBe(404);
  });

  it("callbacks need a valid HMAC and a timestamp within 300 s; nothing is written on rejection", async () => {
    const { id } = await run();
    const ev = { type: "stage", stage: "refine", status: "start" } as const;
    const now = Math.floor(Date.now() / 1000);
    expect((await postEvent(id, 1, ev, { secret: "x".repeat(32) })).status).toBe(401); // wrong key
    expect(
      (await postEvent(id, 1, ev, { secret: deriveCallbackSecret("00000000-0000-4000-8000-000000000001") }))
        .status,
    ).toBe(401); // other run's key
    expect((await postEvent(id, 1, ev, { timestamp: now - 301 })).status).toBe(401); // stale
    expect((await postEvent(id, 1, ev, { timestamp: now + 301 })).status).toBe(401); // future
    expect((await runRow(id))!.status).toBe("launching");
    expect((await postEvent(id, 1, ev, { timestamp: now - 299 })).status).toBe(200); // inside the window
    expect((await runRow(id))!.status).toBe("running");
    // header/run mismatch with a valid signature for the header's run
    const other = await run();
    const r = await postEvent(id, 2, ev, { headerRun: other.id, secret: deriveCallbackSecret(other.id) });
    expect(r.status).toBe(401);
  });

  it("a body edited after signing is rejected", async () => {
    const { id } = await run();
    const { signCallback } = await import("@voidaccess/engine-client");
    const { POST } = await import("@/app/api/engine/runs/[id]/events/route");
    const signed = JSON.stringify({
      run_id: id,
      seq: 1,
      at: new Date().toISOString(),
      stage_total: 8,
      type: "stage",
      stage: "refine",
    });
    const tampered = signed.replace("refine", "extract");
    const headers = signCallback({ secret: deriveCallbackSecret(id), runId: id, seq: 1, rawBody: signed });
    const res = await POST(
      new Request(`${APP}/api/engine/runs/${id}/events`, { method: "POST", body: tampered, headers }),
      ctxFor(id),
    );
    expect(res.status).toBe(401);
  });

  it("the mock bundle PUT needs the derived token", async () => {
    const { id } = await run();
    const put = (t: string) =>
      bundleRoute.PUT(
        new Request(`${APP}/api/engine/runs/${id}/artifacts/bundle?t=${t}`, { method: "PUT", body: "{}" }),
        ctxFor(id),
      );
    expect((await put("nope")).status).toBe(404);
    expect((await put(deriveArtifactToken(id))).status).toBe(200);
  });
});

describe("cron authentication", () => {
  const post = (auth?: string) =>
    watchdogRoute.POST(
      new Request(`${APP}/api/cron/watchdog`, {
        method: "POST",
        headers: auth ? { authorization: auth } : {},
      }),
    );

  it("the watchdog route needs the shared secret (dev) and rejects everything else", async () => {
    expect((await post()).status).toBe(401);
    expect((await post("Bearer wrong")).status).toBe(401);
    expect((await post("Basic " + process.env.CRON_SHARED_SECRET)).status).toBe(401);
    const ok = await post("Bearer " + process.env.CRON_SHARED_SECRET);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toHaveProperty("scanned");
  });

  it("verifies a Google-style OIDC token: signature, audience, email, expiry", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1" };
    const jwks = async () => [jwk as never];
    const mint = (claims: Record<string, unknown>, key = privateKey) => {
      const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const h = b64({ alg: "RS256", kid: "k1", typ: "JWT" });
      const p = b64(claims);
      const sig = createSign("RSA-SHA256").update(`${h}.${p}`).sign(key).toString("base64url");
      return `${h}.${p}.${sig}`;
    };
    const now = Math.floor(Date.now() / 1000);
    const good = {
      iss: "https://accounts.google.com",
      aud: APP,
      exp: now + 300,
      email: "va-app@x.iam.gserviceaccount.com",
      email_verified: true,
    };
    const opts = { audiences: [APP], email: "va-app@x.iam.gserviceaccount.com", jwks };
    expect(await verifyGoogleOidc(mint(good), opts)).toBe(true);
    expect(await verifyGoogleOidc(mint({ ...good, aud: "https://evil" }), opts)).toBe(false);
    expect(await verifyGoogleOidc(mint({ ...good, email: "other@x.iam.gserviceaccount.com" }), opts)).toBe(
      false,
    );
    expect(await verifyGoogleOidc(mint({ ...good, exp: now - 10 }), opts)).toBe(false);
    expect(await verifyGoogleOidc(mint({ ...good, iss: "https://evil.example" }), opts)).toBe(false);
    expect(await verifyGoogleOidc(mint({ ...good, email_verified: false }), opts)).toBe(false);
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(await verifyGoogleOidc(mint(good, other.privateKey), opts)).toBe(false); // forged signature
    const t = mint(good);
    expect(await verifyGoogleOidc(t.slice(0, -4) + (t.endsWith("AAAA") ? "BBBB" : "AAAA"), opts)).toBe(false);
    expect(await verifyGoogleOidc("a.b.c", opts)).toBe(false);
  });
});
