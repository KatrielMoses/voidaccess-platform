/**
 * Creem webhook verification, as Creem documents it (https://docs.creem.io/code/webhooks):
 *   header    = `creem-signature`
 *   signature = hex(HMAC-SHA256(key = the webhook secret as given, message = the raw request body))
 * Compared in constant time. Creem sends no signed timestamp, so replays are stopped by the event-id guard
 * (billing_events) and by applying subscription events as ordered snapshots, not by a freshness window.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "creem-signature";

export type VerifyResult =
  { ok: true } | { ok: false; reason: "missing_signature" | "bad_signature" | "no_secret" };

export function signWebhook(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyWebhook(
  secret: string | undefined,
  headers: { get(name: string): string | null },
  rawBody: string,
): VerifyResult {
  if (!secret) return { ok: false, reason: "no_secret" };
  const sig = headers.get(SIGNATURE_HEADER)?.trim();
  if (!sig) return { ok: false, reason: "missing_signature" };
  if (!/^[0-9a-f]+$/i.test(sig)) return { ok: false, reason: "bad_signature" };
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const got = Buffer.from(sig, "hex");
  if (got.length === expected.length && timingSafeEqual(got, expected)) return { ok: true };
  return { ok: false, reason: "bad_signature" };
}
