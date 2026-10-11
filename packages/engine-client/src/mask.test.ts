import { describe, expect, it } from "vitest";
import { fingerprint, normalizeValue } from "./fingerprint";
import { maskCredential, maskEmail, maskEntityValue, maskPartial, maskPhone, secretValueToken } from "./mask";

describe("masking", () => {
  it("credentials become len:N", () => {
    expect(maskCredential("ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toBe("len:40");
    expect(maskEntityValue("GITHUB_TOKEN", "ghp_x".repeat(8))).toBe("len:40");
    expect(maskEntityValue("AWS_SECRET_KEY", "wJalrXUtnFEMI")).toBe("len:13");
  });
  it("secret value token carries length and 8-hex hash prefix only", () => {
    expect(secretValueToken("hunter2hunter2")).toMatch(/^len:14 sha256:[0-9a-f]{8}$/);
  });
  it("emails keep first char and domain", () => {
    expect(maskEmail("john@acme.com")).toBe("j***@acme.com");
    expect(maskEntityValue("EMAIL_ADDRESS", "jane.doe@mail.example.org")).toBe("j***@mail.example.org");
    expect(maskEmail("not-an-email")).not.toContain("not-an-email");
  });
  it("partial masking is length-aware and never reveals short values", () => {
    expect(maskPartial("abcd")).toBe("****");
    expect(maskPartial("abcdefg")).toBe("a*****g");
    expect(maskPartial("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe("1A1********fNa");
    expect(maskPartial("abcdefghijkl")).toBe("ab********kl");
  });
  it("phones and names are partly masked", () => {
    expect(maskPhone("+1 (555) 123-4567")).toBe("+***67");
    expect(maskEntityValue("PERSON_NAME", "Jane Doe")).toBe("J*** D***");
  });
  it("public indicator types pass through", () => {
    expect(maskEntityValue("CVE_NUMBER", "CVE-2024-3400")).toBe("CVE-2024-3400");
    expect(maskEntityValue("RANSOMWARE_GROUP", "Akira")).toBe("Akira");
  });
});

describe("fingerprint", () => {
  it("is stable, hex, and secret/type dependent", () => {
    const a = fingerprint("k1", "EMAIL_ADDRESS", "john@acme.com");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint("k1", "EMAIL_ADDRESS", "john@acme.com")).toBe(a);
    expect(fingerprint("k2", "EMAIL_ADDRESS", "john@acme.com")).not.toBe(a);
    expect(fingerprint("k1", "DOMAIN", "john@acme.com")).not.toBe(a);
  });
  it("normalises equivalent values", () => {
    expect(fingerprint("k", "EMAIL_ADDRESS", "  John@Acme.COM ")).toBe(
      fingerprint("k", "EMAIL_ADDRESS", "john@acme.com"),
    );
    expect(fingerprint("k", "ONION_URL", "http://abc.onion/")).toBe(
      fingerprint("k", "ONION_URL", "HTTP://ABC.onion"),
    );
    expect(normalizeValue("PHONE_NUMBER", "+1 (555) 123-4567")).toBe("+15551234567");
  });
  it("keeps case for case-sensitive types", () => {
    expect(fingerprint("k", "BITCOIN_ADDRESS", "1A1zP1eP")).not.toBe(
      fingerprint("k", "BITCOIN_ADDRESS", "1a1zp1ep"),
    );
  });
});
