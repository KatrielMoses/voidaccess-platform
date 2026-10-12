import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS = ["NODE_ENV", "NEXT_RUNTIME", "DATABASE_URL", "DATABASE_URL_SYSTEM", "RLS_CONTEXT_KEY"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  vi.resetModules();
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = saved[k]!;
  }
});
const setEnv = (e: Partial<Record<(typeof KEYS)[number], string>>) => {
  for (const k of KEYS) delete (process.env as Record<string, string | undefined>)[k];
  Object.assign(process.env, e);
};

describe("H1-1: production refuses to start without the system login and the context key", () => {
  const good = {
    NODE_ENV: "production",
    NEXT_RUNTIME: "nodejs",
    DATABASE_URL: "postgres://va_app:x@localhost:1/none",
    DATABASE_URL_SYSTEM: "postgres://va_worker:x@localhost:1/none",
    RLS_CONTEXT_KEY: "k".repeat(40),
  } as const;

  it("starts when everything is configured (no connection is opened)", async () => {
    setEnv(good);
    const { register } = await import("../instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });

  it.each([
    ["DATABASE_URL_SYSTEM", /DATABASE_URL_SYSTEM is not set/],
    ["DATABASE_URL", /DATABASE_URL is not set/],
    ["RLS_CONTEXT_KEY", /RLS_CONTEXT_KEY is not set/],
  ] as const)("fails at startup when %s is missing", async (missing, message) => {
    const { [missing]: _drop, ...rest } = good;
    void _drop;
    setEnv(rest);
    const { register } = await import("../instrumentation");
    await expect(register()).rejects.toThrow(message);
  });

  it("rejects a short context key in production", async () => {
    setEnv({ ...good, RLS_CONTEXT_KEY: "short" });
    const { register } = await import("../instrumentation");
    await expect(register()).rejects.toThrow(/at least 32/);
  });

  it("does nothing outside production, and getDatabase still needs the system URL there", async () => {
    setEnv({ NODE_ENV: "development", NEXT_RUNTIME: "nodejs" });
    const { register } = await import("../instrumentation");
    await expect(register()).resolves.toBeUndefined();
    setEnv({ NODE_ENV: "test", DATABASE_URL: good.DATABASE_URL });
    const { getDatabase } = await import("@voidaccess/db");
    expect(() => getDatabase()).toThrow(/DATABASE_URL_SYSTEM is not set/);
  });
});
