/**
 * Standard Webhooks verification, exactly as Dodo documents it:
 *   signed content = `${webhook-id}.${webhook-timestamp}.${raw body}`
 *   signature      = base64(HMAC-SHA256(key, content)); key = base64-decoded secret after the `whsec_` prefix
 *   header         = space-separated `v1,<signature>` entries; any match is valid (constant-time compare)
 *   timestamp      = unix seconds; rejected outside a 5 minute window.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type VerifyResult =
  | { ok: true; id: string }
  | { ok: false; reason: "missing_headers" | "bad_timestamp" | "stale" | "bad_signature" | "no_secret" };

function key(secret: string): Buffer {
  return Buffer.from(
    secret.startsWith("whsec_") ? secret.slice(6) : secret,
    secret.startsWith("whsec_") ? "base64" : "utf8",
  );
}

export function signWebhook(secret: string, id: string, timestampSeconds: number, body: string): string {
  return (
    "v1," + createHmac("sha256", key(secret)).update(`${id}.${timestampSeconds}.${body}`).digest("base64")
  );
}

export function verifyWebhook(
  secret: string | undefined,
  headers: { get(name: string): string | null },
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifyResult {
  if (!secret) return { ok: false, reason: "no_secret" };
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sig = headers.get("webhook-signature");
  if (!id || !ts || !sig) return { ok: false, reason: "missing_headers" };
  const t = Number(ts);
  if (!Number.isInteger(t)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(nowSeconds - t) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };
  const expected = createHmac("sha256", key(secret)).update(`${id}.${t}.${rawBody}`).digest();
  for (const entry of sig.split(" ")) {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) continue;
    const got = Buffer.from(value, "base64");
    if (got.length === expected.length && timingSafeEqual(got, expected)) return { ok: true, id };
  }
  return { ok: false, reason: "bad_signature" };
}
