import { describe, expect, it } from "vitest";
import { HEADER_SIGNATURE, HEADER_TIMESTAMP, signCallback, verifyCallback } from "./hmac";

const secret = "s3cret-s3cret-s3cret";
const body = JSON.stringify({ run_id: "r1", seq: 3, type: "stage" });
const now = 1_800_000_000;

describe("callback signing", () => {
  it("round-trips", () => {
    const headers = signCallback({ secret, runId: "r1", seq: 3, rawBody: body, timestamp: now });
    expect(headers["X-VA-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyCallback({ secret, headers, rawBody: body, now })).toEqual({
      ok: true,
      runId: "r1",
      seq: 3,
      timestamp: now,
    });
  });

  it("is case-insensitive on header names", () => {
    const headers = signCallback({ secret, runId: "r1", seq: 0, rawBody: body, timestamp: now });
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    expect(verifyCallback({ secret, headers: lower, rawBody: body, now }).ok).toBe(true);
  });

  it("rejects a tampered body, wrong secret, and tampered seq/timestamp", () => {
    const headers = signCallback({ secret, runId: "r1", seq: 3, rawBody: body, timestamp: now });
    expect(verifyCallback({ secret, headers, rawBody: body + " ", now })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
    expect(verifyCallback({ secret: "other-other-other-x", headers, rawBody: body, now })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
    const shifted = { ...headers, [HEADER_TIMESTAMP]: String(now + 1) };
    expect(verifyCallback({ secret, headers: shifted, rawBody: body, now })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("enforces <= 5 min skew in both directions", () => {
    const old = signCallback({ secret, runId: "r1", seq: 1, rawBody: body, timestamp: now - 300 });
    expect(verifyCallback({ secret, headers: old, rawBody: body, now }).ok).toBe(true);
    const stale = signCallback({ secret, runId: "r1", seq: 1, rawBody: body, timestamp: now - 301 });
    expect(verifyCallback({ secret, headers: stale, rawBody: body, now })).toEqual({
      ok: false,
      reason: "timestamp_skew",
    });
    const future = signCallback({ secret, runId: "r1", seq: 1, rawBody: body, timestamp: now + 301 });
    expect(verifyCallback({ secret, headers: future, rawBody: body, now })).toEqual({
      ok: false,
      reason: "timestamp_skew",
    });
  });

  it("rejects missing and malformed headers", () => {
    const headers = signCallback({ secret, runId: "r1", seq: 1, rawBody: body, timestamp: now });
    const { [HEADER_SIGNATURE]: _drop, ...rest } = headers;
    expect(verifyCallback({ secret, headers: rest, rawBody: body, now })).toEqual({
      ok: false,
      reason: "missing_header",
    });
    expect(
      verifyCallback({
        secret,
        headers: { ...headers, [HEADER_SIGNATURE]: "sha256=zz" },
        rawBody: body,
        now,
      }),
    ).toEqual({ ok: false, reason: "bad_signature_format" });
    expect(
      verifyCallback({ secret, headers: { ...headers, [HEADER_TIMESTAMP]: "abc" }, rawBody: body, now }),
    ).toEqual({ ok: false, reason: "bad_timestamp" });
  });
});
