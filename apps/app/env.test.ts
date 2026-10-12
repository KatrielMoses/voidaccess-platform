import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("accepts an empty env with defaults", () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.COMMIT_SHA).toBe("dev");
  });

  it("treats blank values as unset", () => {
    expect(parseEnv({ DATABASE_URL: "" }).DATABASE_URL).toBeUndefined();
  });

  it("passes through a configured database url", () => {
    expect(parseEnv({ DATABASE_URL: "postgres://x/y" }).DATABASE_URL).toBe("postgres://x/y");
  });

  it("accepts the system login URL and a context key of at least 32 characters, rejects a short key", () => {
    const env = parseEnv({ DATABASE_URL_SYSTEM: "postgres://w/y", RLS_CONTEXT_KEY: "k".repeat(32) });
    expect(env.DATABASE_URL_SYSTEM).toBe("postgres://w/y");
    expect(env.RLS_CONTEXT_KEY).toHaveLength(32);
    expect(() => parseEnv({ RLS_CONTEXT_KEY: "short" })).toThrow(/RLS_CONTEXT_KEY/);
  });

  it("rejects an invalid APP_URL and NODE_ENV", () => {
    expect(() => parseEnv({ APP_URL: "not a url" })).toThrow(/APP_URL/);
    expect(() => parseEnv({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});
