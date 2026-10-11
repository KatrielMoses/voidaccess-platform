import { hmacHex, randomToken, sha256Hex } from "./crypto";
import type { Mailer } from "./email";
import type { RateLimiter } from "./ratelimit";
import type { WaitlistStore } from "./store";
import type { TurnstileVerifier } from "./turnstile";
import { sanitizeFirstTouch, waitlistInput } from "./validate";

export const LIMITS = { perIpBurst: 5, burstWindowSec: 60, perIpPerDay: 20, perEmailPerHour: 3 } as const;

export interface JoinDeps {
  store: WaitlistStore;
  mailer: Mailer;
  limiter: RateLimiter;
  verifyTurnstile: TurnstileVerifier;
  ipSalt: string;
  siteUrl: string;
  /** Builds the confirmation email from the link; copy lives in content/waitlist.ts. */
  confirmationMail: (link: string) => { subject: string; text: string };
  now?: () => Date;
}

export type JoinResult =
  | { status: 200; body: { ok: true }; background: () => Promise<void> }
  | { status: 400; body: { ok: false; error: "invalid_input" | "captcha_failed" }; background?: undefined }
  | { status: 429; body: { ok: false; error: "rate_limited" }; background?: undefined };

/**
 * The response for a valid submission is identical whether the email is new, unconfirmed or already
 * confirmed (no account enumeration). Only the confirmation email, which differs, is sent in `background`
 * after the response is built.
 */
export async function joinWaitlist(raw: unknown, req: { ip: string | null }, deps: JoinDeps): Promise<JoinResult> {
  const now = deps.now?.() ?? new Date();
  const parsed = waitlistInput.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { ok: false, error: "invalid_input" } };
  const input = parsed.data;

  // Honeypot: pretend success, do nothing.
  if (input.website) return { status: 200, body: { ok: true }, background: async () => {} };

  const ipHash = await hmacHex(deps.ipSalt, req.ip ?? "unknown");

  if (!(await deps.limiter.hit(`ip:${ipHash}`, LIMITS.perIpBurst, LIMITS.burstWindowSec))) {
    return { status: 429, body: { ok: false, error: "rate_limited" } };
  }
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  if ((await deps.store.countRecentByIp(ipHash, dayAgo)) >= LIMITS.perIpPerDay) {
    return { status: 429, body: { ok: false, error: "rate_limited" } };
  }
  if (!(await deps.verifyTurnstile(input.turnstileToken, req.ip))) {
    return { status: 400, body: { ok: false, error: "captcha_failed" } };
  }

  const email = input.email;
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const inserted = await deps.store.insertIfNew({
    email,
    role: input.role,
    useCase: input.useCase,
    wantsFounding: input.wantsFounding,
    consentMarketing: input.consentMarketing,
    refCode: input.refCode,
    firstTouch: sanitizeFirstTouch(input.firstTouch),
    ipHash,
    confirmTokenHash: tokenHash,
  });
  let send = inserted;
  if (!inserted) {
    const existing = await deps.store.find(email);
    if (existing && !existing.confirmed) {
      // Still unconfirmed: re-send, but capped per email so this can't be used to spam someone.
      const emailKey = `email:${await sha256Hex(email)}`;
      if (await deps.limiter.hit(emailKey, LIMITS.perEmailPerHour, 3600)) {
        await deps.store.refreshToken(email, tokenHash, { wantsFounding: input.wantsFounding, consentMarketing: input.consentMarketing });
        send = true;
      }
    }
  }
  const background = async () => {
    if (!send) return;
    const link = `${deps.siteUrl}/api/waitlist/confirm?token=${encodeURIComponent(token)}`;
    await deps.mailer.send({ to: email, ...deps.confirmationMail(link) });
  };

  return { status: 200, body: { ok: true }, background };
}

export async function confirmWaitlist(token: string | null, store: WaitlistStore): Promise<"confirmed" | "already" | "invalid"> {
  if (!token || token.length < 20 || token.length > 200) return "invalid";
  return store.confirm(await sha256Hex(token));
}
