/**
 * NOWPayments IPN signatures.
 *   header    = x-nowpayments-sig: hex(HMAC-SHA512(ipn secret, sorted JSON of the body))
 *
 * "Sorted JSON" is where sources disagree. NOWPayments' own docs and Node sample use
 * `JSON.stringify(params, Object.keys(params).sort())`: top-level keys sorted, and (a quirk of the replacer-array
 * form) nested objects keep only properties whose names also appear at the top level. Other official samples and
 * client libraries sort keys recursively and keep everything. IPN bodies are normally flat, where both forms are
 * identical; for a body with nested objects we can't confirm which one NOWPayments signs, so we compute both and
 * accept either. Both are HMACs under our secret, so accepting two canonical forms doesn't let anyone forge one.
 * Comparison is constant-time on equal-length buffers.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type IpnVerifyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: "no_secret" | "missing_signature" | "bad_payload" | "bad_signature" };

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortDeep(o[k])]),
    );
  }
  return v;
}

/** Recursive key sort. */
export const canonicalRecursive = (obj: Record<string, unknown>) => JSON.stringify(sortDeep(obj));
/** NOWPayments' documented form: the sorted top-level key list as the replacer. */
export const canonicalTopLevel = (obj: Record<string, unknown>) =>
  JSON.stringify(obj, Object.keys(obj).sort());

const hmac = (secret: string, s: string) => createHmac("sha512", secret).update(s).digest("hex");

/** What NOWPayments would send for this body (recursive form by default). For tests and e2e. */
export function signIpn(
  secret: string,
  body: Record<string, unknown>,
  form: "recursive" | "top-level" = "recursive",
): string {
  return hmac(secret, form === "recursive" ? canonicalRecursive(body) : canonicalTopLevel(body));
}

export function verifyIpn(
  secret: string | undefined,
  headers: { get(name: string): string | null },
  rawBody: string,
): IpnVerifyResult {
  if (!secret) return { ok: false, reason: "no_secret" };
  const sig = headers.get("x-nowpayments-sig")?.trim().toLowerCase();
  if (!sig) return { ok: false, reason: "missing_signature" };
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "bad_payload" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "bad_payload" };
  const obj = body as Record<string, unknown>;
  if (!/^[0-9a-f]+$/.test(sig)) return { ok: false, reason: "bad_signature" };
  const got = Buffer.from(sig, "hex");
  for (const form of new Set([canonicalRecursive(obj), canonicalTopLevel(obj)])) {
    const expected = Buffer.from(hmac(secret, form), "hex");
    if (got.length === expected.length && timingSafeEqual(got, expected)) return { ok: true, body: obj };
  }
  return { ok: false, reason: "bad_signature" };
}
