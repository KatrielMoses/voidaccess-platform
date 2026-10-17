import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { config } from "../proxy";

// The matcher is a single regex-style group; anchoring it mirrors how Next applies it to a pathname.
const guarded = (pathname: string) => new RegExp(`^${config.matcher[0]}$`).test(pathname);

describe("proxy matcher", () => {
  it("lets every file in public/ through without a session (fonts, logo, icons)", () => {
    const pub = path.join(import.meta.dirname, "../public");
    const files = [
      ...readdirSync(pub).filter((f) => !f.startsWith(".") && f !== "fonts"),
      ...readdirSync(path.join(pub, "fonts")).map((f) => `fonts/${f}`),
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(guarded(`/${f}`), f).toBe(false);
  });

  it("still guards pages, APIs and look-alike paths", () => {
    for (const p of ["/", "/welcome", "/investigations", "/api/billing/checkout", "/fontsx", "/admin"])
      expect(guarded(p), p).toBe(true);
  });
});
