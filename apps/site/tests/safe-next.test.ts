import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/safe-next";

const APP = "https://app.voidaccess.pro";
const FALLBACK = `${APP}/welcome`;

describe("safeNext", () => {
  it("accepts absolute URLs on exactly the app origin and keeps path, query and hash", () => {
    expect(safeNext("https://app.voidaccess.pro/investigations/42?tab=graph#top", APP)).toBe("https://app.voidaccess.pro/investigations/42?tab=graph#top");
    expect(safeNext("https://app.voidaccess.pro", APP)).toBe("https://app.voidaccess.pro/");
  });

  it("accepts app-relative paths, resolved against the app origin", () => {
    expect(safeNext("/investigations/42", APP)).toBe("https://app.voidaccess.pro/investigations/42");
  });

  it("falls back when empty", () => {
    expect(safeNext(null, APP)).toBe(FALLBACK);
    expect(safeNext(undefined, APP)).toBe(FALLBACK);
    expect(safeNext("", APP)).toBe(FALLBACK);
  });

  it.each([
    ["protocol-relative", "//evil.com"],
    ["protocol-relative with path", "//evil.com/welcome"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["suffix host", "https://app.voidaccess.pro.evil.com/welcome"],
    ["prefix host", "https://evilapp.voidaccess.pro/welcome"],
    ["userinfo trick", "https://app.voidaccess.pro@evil.com/welcome"],
    ["userinfo with credentials", "https://user:pw@app.voidaccess.pro/welcome"],
    ["other origin", "https://voidaccess.pro/welcome"],
    ["other scheme, same host", "http://app.voidaccess.pro/welcome"],
    ["other port", "https://app.voidaccess.pro:8443/welcome"],
    ["ftp", "ftp://app.voidaccess.pro/welcome"],
    ["backslash trick", "https://evil.com\\@app.voidaccess.pro"],
    ["slash-backslash", "/\\evil.com"],
    ["backslash relative", "\\\\evil.com"],
    ["tab inside scheme", "java\tscript:alert(1)"],
    ["leading space", " https://evil.com"],
    ["newline", "https://app.voidaccess.pro/\nhttps://evil.com"],
    ["bare host", "evil.com"],
    ["encoded slashes", "/%2F%2Fevil.com"],
  ])("rejects %s", (_name, value) => {
    const out = safeNext(value, APP);
    // Either the fallback, or (for the encoded case) still on the app origin.
    expect(new URL(out).origin).toBe(APP);
    if (value !== "/%2F%2Fevil.com") expect(out).toBe(FALLBACK);
  });

  it("works for a local http app origin and still rejects lookalikes", () => {
    const local = "http://app.va.localhost:3600";
    expect(safeNext("http://app.va.localhost:3600/x", local)).toBe("http://app.va.localhost:3600/x");
    expect(safeNext("https://app.va.localhost:3600/x", local)).toBe("http://app.va.localhost:3600/welcome");
    expect(safeNext("http://app.va.localhost:3601/x", local)).toBe("http://app.va.localhost:3600/welcome");
  });

  it("caps absurdly long input", () => {
    expect(safeNext(`/${"a".repeat(3000)}`, APP)).toBe(FALLBACK);
  });
});
