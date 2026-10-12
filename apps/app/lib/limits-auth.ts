// Auth rate limits (per IP, in-memory store: per-instance on Cloud Run; move to a shared store when scaling out).
// Keys are Better Auth paths. These are security settings, so they stay in the app (not config).
export const AUTH_RATE_LIMITS = {
  "/sign-in/email": { window: 60, max: 10 },
  "/sign-up/email": { window: 60, max: 5 },
  "/sign-in/magic-link": { window: 60, max: 5 },
  "/request-password-reset": { window: 60, max: 5 },
  "/send-verification-email": { window: 60, max: 5 },
  "/reset-password": { window: 60, max: 10 },
} as const;
