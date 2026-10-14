// Drives the real passwordless auth API (Better Auth handler) the way the site does: request a sign-in code, read it
// from the log transport, sign in with it. The first sign-in creates the account.
import { getLogTransport } from "@voidaccess/emails";
import { getAuth } from "@/lib/auth/auth";

export const SITE_ORIGIN = "http://va.localhost:3700"; // a trusted origin outside production

let n = 0;
/** A fresh client IP per call: the auth rate limiter is per IP. */
export const freshIp = () => `10.${20 + Math.floor(++n / 62500)}.${Math.floor(n / 250) % 250}.${n % 250}`;

export interface AuthPostOptions {
  origin?: string;
  ip?: string;
  cookie?: string;
  auth?: { handler: (req: Request) => Promise<Response> };
}

export async function authPost(path: string, body: Record<string, unknown>, o: AuthPostOptions = {}) {
  const res = await (o.auth ?? getAuth()).handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: o.origin ?? SITE_ORIGIN,
        "x-forwarded-for": o.ip ?? freshIp(),
        ...(o.cookie ? { cookie: o.cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: res.status,
    headers: res.headers,
    json: (await res.json().catch(() => null)) as { message?: string; user?: { id: string } } | null,
  };
}

/** The most recent sign-in code emailed to `email` (from the log transport), if any. */
export function lastSignInCode(email: string): string | undefined {
  const box = getLogTransport()?.outbox ?? [];
  for (let i = box.length - 1; i >= 0; i--) {
    const m = box[i]!;
    if (m.to === email.toLowerCase() && m.template === "signInCode")
      return /\b(\d{6})\b/.exec(m.subject)?.[1];
  }
  return undefined;
}

export const requestCode = (email: string, o: AuthPostOptions = {}) =>
  authPost("/email-otp/send-verification-otp", { email, type: "sign-in" }, o);

/** Request a code, read it, sign in with it. `extra` is sent with the sign-in (e.g. firstTouch). */
export async function signInWithCode(
  email: string,
  extra: Record<string, unknown> = {},
  o: AuthPostOptions = {},
) {
  const sent = await requestCode(email, o);
  if (sent.status !== 200) return sent;
  const otp = lastSignInCode(email);
  if (!otp) throw new Error(`no sign-in code was emailed to ${email}`);
  return authPost("/sign-in/email-otp", { email, otp, ...extra }, o);
}

/** The session cookie from a sign-in response, as a Cookie header value. */
export function sessionCookie(res: { headers: Headers }): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
