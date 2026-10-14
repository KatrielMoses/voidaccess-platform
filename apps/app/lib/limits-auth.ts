// Auth rate limits (per IP). The counters are shared across instances in Postgres (lib/rate-limit.ts).
// Keys are Better Auth paths. These are security settings, so they stay in the app (not config).
export const AUTH_RATE_LIMITS = {
  "/email-otp/send-verification-otp": { window: 60, max: 5 }, // sends an email: the abusable one
  "/sign-in/email-otp": { window: 60, max: 10 }, // codes also lock after 5 wrong attempts
  "/sign-in/social": { window: 60, max: 20 },
} as const;
