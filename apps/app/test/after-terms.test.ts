import { describe, expect, it } from "vitest";
import { afterTermsPath } from "@/lib/auth/after-terms";

describe("after accepting the policy, the user continues where they were heading", () => {
  it("keeps a path on this app, query included", () => {
    expect(afterTermsPath("/investigations/new?q=LockBit%20ransomware")).toBe(
      "/investigations/new?q=LockBit%20ransomware",
    );
    expect(afterTermsPath("/billing")).toBe("/billing");
  });
  it("never leaves the app: other origins, protocol-relative and backslash tricks fall back to /welcome", () => {
    for (const v of [
      "https://evil.example/",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "",
      null,
      42,
    ])
      expect(afterTermsPath(v), String(v)).toBe("/welcome");
  });
  it("does not loop back to the terms page or stop at the bare root", () => {
    expect(afterTermsPath("/accept-terms?next=/x")).toBe("/welcome");
    expect(afterTermsPath("/")).toBe("/welcome");
  });
});
