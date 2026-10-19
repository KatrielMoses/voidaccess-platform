/**
 * The admin step-up: after a correct authenticator code the owner holds a signed cookie for exactly one hour.
 * Value = base64url(JSON {u: userId, s: hash of the session id, e: expiresAt ms}) + "." + base64url(HMAC-SHA256).
 * The HMAC key is derived from BETTER_AUTH_SECRET with its own label, so it can't be confused with any other
 * signature in the app. The cookie is invalid for another user, another session (sign-out/in), after expiry, or
 * with any byte changed.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const STEP_UP_COOKIE = "va_admin_stepup";
export const STEP_UP_SECONDS = 3600;
const LABEL = "voidaccess:admin-step-up:v1";

function key(): Buffer {
  const base = process.env.BETTER_AUTH_SECRET;
  if (!base && process.env.NODE_ENV === "production") throw new Error("BETTER_AUTH_SECRET is required");
  return createHmac("sha256", base ?? "dev-only-secret-dev-only-secret-dev-only-secret")
    .update(LABEL)
    .digest();
}

/** A one-way hash of the session id (the cookie never carries the id itself). */
export const sessionHash = (sessionId: string) =>
  createHash("sha256").update(`admin-step-up:${sessionId}`).digest("base64url").slice(0, 32);

const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

export function signStepUp(userId: string, sessionId: string, nowMs = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, s: sessionHash(sessionId), e: nowMs + STEP_UP_SECONDS * 1000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyStepUp(
  value: string | undefined | null,
  userId: string,
  sessionId: string,
  nowMs = Date.now(),
): boolean {
  if (!value || value.length > 512) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const payload = value.slice(0, dot);
  const mac = Buffer.from(value.slice(dot + 1));
  const want = Buffer.from(sign(payload));
  if (mac.length !== want.length || !timingSafeEqual(mac, want)) return false;
  let p: { u?: unknown; s?: unknown; e?: unknown };
  try {
    p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as typeof p;
  } catch {
    return false;
  }
  if (p.u !== userId || p.s !== sessionHash(sessionId) || typeof p.e !== "number") return false;
  // expired, or a validity longer than one hour (never issued by us)
  return p.e > nowMs && p.e <= nowMs + STEP_UP_SECONDS * 1000;
}

/** Set-Cookie attributes: httpOnly, Secure, SameSite=Strict, path "/", Max-Age 3600. */
export const stepUpCookieOptions = (maxAge = STEP_UP_SECONDS) =>
  ({ httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge }) as const;
