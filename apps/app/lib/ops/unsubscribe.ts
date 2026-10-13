/**
 * Signed one-click unsubscribe links for lifecycle/marketing email.
 *
 * The signature is HMAC-SHA256 over the user id, keyed by a purpose-bound key DERIVED from the app secret
 * (HMAC(appSecret, "voidaccess:unsubscribe:v1")), so the raw secret never signs anything directly and a token can't be
 * replayed for another purpose. A link only ever unsubscribes the user whose id is signed into it: changing the id
 * invalidates the signature, and the token carries nothing else. No sign-in is needed to use it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../../env";

const PURPOSE = "voidaccess:unsubscribe:v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same source and dev fallback as the auth layer (lib/auth/auth.ts); required in production there. */
function appSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("BETTER_AUTH_SECRET is required in production");
  return "dev-only-secret-dev-only-secret-dev-only-secret";
}

const unsubscribeKey = () => createHmac("sha256", appSecret()).update(PURPOSE).digest();

export function signUnsubscribe(userId: string): string {
  return createHmac("sha256", unsubscribeKey()).update(userId.toLowerCase()).digest("base64url");
}

export function verifyUnsubscribe(userId: string, token: string): boolean {
  if (!UUID_RE.test(userId) || typeof token !== "string" || token.length === 0) return false;
  const want = Buffer.from(signUnsubscribe(userId));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

const base = () => getEnv().APP_URL.replace(/\/$/, "");
const query = (userId: string) => `u=${encodeURIComponent(userId)}&t=${signUnsubscribe(userId)}`;

/** The confirmation page a person lands on from the email footer. */
export const unsubscribePageUrl = (userId: string) => `${base()}/unsubscribe?${query(userId)}`;
/** The List-Unsubscribe target: a POST here unsubscribes immediately (RFC 8058 one-click). */
export const unsubscribeOneClickUrl = (userId: string) => `${base()}/api/unsubscribe?${query(userId)}`;
