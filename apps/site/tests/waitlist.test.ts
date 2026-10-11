import { describe, expect, it, vi } from "vitest";
import type { Mail, Mailer } from "@/lib/waitlist/email";
import { MemoryRateLimiter } from "@/lib/waitlist/ratelimit";
import { confirmWaitlist, joinWaitlist, LIMITS, type JoinDeps } from "@/lib/waitlist/service";
import { memoryStore } from "@/lib/waitlist/store";
import { sanitizeFirstTouch, waitlistInput } from "@/lib/waitlist/validate";

function setup(over: Partial<JoinDeps> = {}) {
  const sent: Mail[] = [];
  const mailer: Mailer = { kind: "log", send: async (m) => void sent.push(m) };
  const store = memoryStore();
  const deps: JoinDeps = {
    store,
    mailer,
    limiter: new MemoryRateLimiter(),
    verifyTurnstile: async (t) => t === "ok",
    ipSalt: "salt",
    siteUrl: "https://example.test",
    confirmationMail: (link) => ({ subject: "s", text: `link ${link}` }),
    ...over,
  };
  return { deps, store, sent };
}
const body = (email: string, extra = {}) => ({ email, turnstileToken: "ok", ...extra });
const join = async (raw: unknown, deps: JoinDeps, ip = "1.1.1.1") => {
  const r = await joinWaitlist(raw, { ip }, deps);
  if (r.status === 200) await r.background();
  return r;
};

describe("validation", () => {
  it("normalises and accepts a good email", () => expect(waitlistInput.parse({ email: "  A@B.Co " }).email).toBe("a@b.co"));
  it.each(["", "nope", "a@", "@b.co", "a b@c.co", "x".repeat(300) + "@a.co"])("rejects %j", (e) => expect(waitlistInput.safeParse({ email: e }).success).toBe(false));
  it("keeps only known first-touch keys", () => {
    expect(sanitizeFirstTouch({ utm_source: "x", evil: "y", ref: 5 })).toEqual({ utm_source: "x" });
  });
  it("returns 400 for bad input", async () => {
    const { deps } = setup();
    expect((await join({ email: "bad", turnstileToken: "ok" }, deps)).status).toBe(400);
  });
});

describe("abuse protection", () => {
  it("rejects a failed captcha without writing", async () => {
    const { deps, store } = setup();
    const r = await join(body("a@b.co", { turnstileToken: "bad" }), deps);
    expect(r).toMatchObject({ status: 400, body: { error: "captcha_failed" } });
    expect(store.rows).toHaveLength(0);
  });
  it("rate limits a burst from one IP", async () => {
    const { deps } = setup();
    const statuses: number[] = [];
    for (let i = 0; i < LIMITS.perIpBurst + 2; i++) statuses.push((await join(body(`u${i}@b.co`), deps)).status);
    expect(statuses.slice(0, LIMITS.perIpBurst).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(LIMITS.perIpBurst)).toEqual([429, 429]);
  });
  it("does not rate limit different IPs against each other", async () => {
    const { deps } = setup();
    for (let i = 0; i < LIMITS.perIpBurst; i++) await join(body(`a${i}@b.co`), deps, "1.1.1.1");
    expect((await join(body("z@b.co"), deps, "2.2.2.2")).status).toBe(200);
  });
  it("enforces the daily per-IP cap from stored rows", async () => {
    const { deps } = setup({ limiter: { hit: async () => true } });
    for (let i = 0; i < LIMITS.perIpPerDay; i++) await join(body(`d${i}@b.co`), deps);
    expect((await join(body("over@b.co"), deps)).status).toBe(429);
  });
  it("silently drops honeypot submissions", async () => {
    const { deps, store } = setup();
    expect((await join(body("bot@b.co", { website: "http://spam" }), deps)).status).toBe(200);
    expect(store.rows).toHaveLength(0);
  });
  it("stores only a salted hash of the IP", async () => {
    const { deps, store } = setup();
    await join(body("a@b.co"), deps, "203.0.113.9");
    expect(store.rows[0]!.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(store.rows)).not.toContain("203.0.113.9");
  });
});

describe("no account enumeration", () => {
  it("gives the identical response for new, unconfirmed and confirmed emails", async () => {
    const { deps, store, sent } = setup({ limiter: { hit: async () => true } });
    const fresh = await join(body("same@b.co"), deps);
    const again = await join(body("SAME@b.co"), deps);
    const link = sent.at(-1)!.text.match(/token=([^\s]+)/)![1]!;
    expect(await confirmWaitlist(decodeURIComponent(link), store)).toBe("confirmed");
    const afterConfirm = await join(body("same@b.co"), deps);
    for (const r of [again, afterConfirm]) expect({ status: r.status, body: r.body }).toEqual({ status: fresh.status, body: fresh.body });
    expect(store.rows).toHaveLength(1);
  });
  it("re-sends only while unconfirmed, and never mails a confirmed address", async () => {
    const { deps, store, sent } = setup({ limiter: { hit: async () => true } });
    await join(body("x@b.co"), deps);
    await join(body("x@b.co"), deps);
    expect(sent).toHaveLength(2);
    const tok = decodeURIComponent(sent[1]!.text.match(/token=([^\s]+)/)![1]!);
    await confirmWaitlist(tok, store);
    await join(body("x@b.co"), deps);
    expect(sent).toHaveLength(2);
  });
  it("caps re-sends per email", async () => {
    const { deps, sent } = setup({ limiter: new MemoryRateLimiter() });
    const fresh = vi.fn();
    void fresh;
    for (let i = 0; i < 6; i++) await join(body("cap@b.co"), deps, `10.0.0.${i}`);
    expect(sent.length).toBeLessThanOrEqual(1 + LIMITS.perEmailPerHour);
  });
});

describe("confirm", () => {
  it("rejects garbage tokens and flips confirmed once", async () => {
    const { deps, store, sent } = setup();
    expect(await confirmWaitlist(null, store)).toBe("invalid");
    expect(await confirmWaitlist("short", store)).toBe("invalid");
    expect(await confirmWaitlist("x".repeat(40), store)).toBe("invalid");
    await join(body("c@b.co"), deps);
    const tok = decodeURIComponent(sent[0]!.text.match(/token=([^\s]+)/)![1]!);
    expect(await confirmWaitlist(tok, store)).toBe("confirmed");
    expect(await confirmWaitlist(tok, store)).toBe("already");
  });
});
