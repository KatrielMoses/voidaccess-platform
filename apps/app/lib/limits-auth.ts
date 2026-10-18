// Auth rate limits (per IP). The counters are shared across instances in Postgres (lib/rate-limit.ts).
// Keys are Better Auth paths. These are security settings, so they stay in the app (not config).
export const AUTH_RATE_LIMITS = {
  "/email-otp/send-verification-otp": { window: 60, max: 5 }, // sends an email: the abusable one
  "/sign-in/email-otp": { window: 60, max: 10 }, // codes also lock after 5 wrong attempts
  "/sign-in/social": { window: 60, max: 20 },
} as const;

/**
 * Sign-in codes per email address, on top of the per-IP limit above (the captcha is invisible, so this is what keeps
 * one inbox from being flooded from many IPs). Keyed by a keyed hash of the address, never the address itself.
 */
export const EMAIL_CODE_LIMITS = [
  ["10m", { window: 10 * 60, max: 3 }],
  ["1d", { window: 24 * 60 * 60, max: 10 }],
] as const;
