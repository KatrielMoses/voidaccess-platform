import { and, eq, isNull } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { captcha, emailOTP } from "better-auth/plugins";
import { randomBytes } from "node:crypto";
import { sendEmail } from "@voidaccess/emails";
import { grantMonthly, getDatabase, type Database } from "@voidaccess/db";
import { accounts, rateLimits, sessions, users, verifications } from "@voidaccess/db/schema";
import { getAuthDb } from "./auth-db";
import { saveFirstTouch } from "./bootstrap";
import { trackEvent } from "@/lib/analytics";
import { sendLifecycle } from "@/lib/lifecycle/send";
import { AUTH_RATE_LIMITS } from "../limits-auth";
import { accountExists, isBlockedEmail, signUpRefused } from "./blocked-domains";
import { createAuthRateLimitStorage } from "../rate-limit";
import { parseAttribution } from "./attribution";
import { cookieDomainCovers, trustedOrigins } from "./origins";

const isProd = process.env.NODE_ENV === "production";
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const siteUrl = process.env.SITE_URL ?? "https://voidaccess.pro";
const cookieDomain = process.env.COOKIE_DOMAIN;
const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (s) return s;
  if (isProd) throw new Error("BETTER_AUTH_SECRET is required in production");
  return "dev-only-secret-dev-only-secret-dev-only-secret";
}

export const githubEnabled = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
export const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const microsoftEnabled = Boolean(
  process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET,
);

/**
 * Sign-in is passwordless: Google, Microsoft, GitHub, or a 6-digit code sent by email. There is no separate sign-up;
 * the first successful sign-in creates the account (email already verified). The Acceptable Use Policy is accepted on
 * the app's /accept-terms page before anything else, for every method.
 */
export const SEND_CODE_PATH = "/email-otp/send-verification-otp";
export const CODE_SIGN_IN_PATH = "/sign-in/email-otp";
export const SIGN_IN_CODE_MINUTES = 10;

/** Client IP for rate limits: the header the real front end sets (cf-connecting-ip behind Cloudflare, x-forwarded-for
 * behind Google's front end). Unset: Better Auth's default. */
const ipHeader = process.env.AUTH_IP_HEADER;

function build(database?: Database) {
  if (isProd && !cookieDomain)
    throw new Error("COOKIE_DOMAIN is required in production (shared session cookie)");
  if (isProd && !turnstileSecret) throw new Error("TURNSTILE_SECRET_KEY is required in production");
  if (cookieDomain && !cookieDomainCovers(cookieDomain, [appUrl, siteUrl]))
    throw new Error("COOKIE_DOMAIN must cover both APP_URL and SITE_URL");
  return betterAuth({
    baseURL: appUrl,
    secret: secret(),
    trustedOrigins: trustedOrigins(appUrl, siteUrl, isProd),
    database: drizzleAdapter(getAuthDb(database).db, {
      provider: "pg",
      usePlural: true,
      // rateLimits: the table behind `storage: "database"` (same shape as Better Auth's own rateLimit model)
      schema: { users, sessions, accounts, verifications, rateLimits },
    }),
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: isProd,
      // httpOnly + SameSite=Lax; Secure in production. Session tokens are never readable by JavaScript.
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: isProd },
      disableCSRFCheck: false, // Origin / Fetch-Metadata checks stay on
      disableOriginCheck: false, // explicit: Better Auth switches it off by default under NODE_ENV=test
      // One session across voidaccess.pro and app.voidaccess.pro. Same attributes as above, just a parent domain.
      ...(cookieDomain ? { crossSubDomainCookies: { enabled: true, domain: cookieDomain } } : {}),
      ...(ipHeader ? { ipAddress: { ipAddressHeaders: [ipHeader] } } : {}),
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SEND_CODE_PATH) return;
        const body = ctx.body as { email?: unknown; type?: unknown } | undefined;
        if (body?.type !== "sign-in")
          throw new APIError("BAD_REQUEST", { message: "Only sign-in codes are supported" });
        const email = typeof body.email === "string" ? body.email : null;
        // A code for an unknown address creates the account on first sign-in, so refuse blocked domains here for
        // new addresses (same generic error). Existing accounts on such a domain can still sign in.
        if (email && (await isBlockedEmail(email)) && !(await accountExists(email))) throw signUpRefused();
      }),
    },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    // Same email, any method, one account: a later Google or GitHub sign-in joins the account an email code created
    // (both providers verify the address). Microsoft is deliberately NOT trusted for automatic linking: multi-tenant
    // Entra can return an unverified email, a known takeover path. A Microsoft sign-in for an email that already has
    // an account is refused; the user signs in with a code once and connects Microsoft in Settings.
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google", "github"], allowDifferentEmails: false },
    },
    // Counters live in Postgres (rate_limits) so the limits hold across Cloud Run instances; hits are recorded in
    // rate_limit_events. See lib/rate-limit.ts.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      storage: "database",
      customStorage: createAuthRateLimitStorage(database ? () => database : undefined),
      customRules: AUTH_RATE_LIMITS,
    },
    // Each provider is on only when its credentials are configured.
    socialProviders: {
      ...(githubEnabled
        ? {
            github: {
              clientId: process.env.GITHUB_CLIENT_ID!,
              clientSecret: process.env.GITHUB_CLIENT_SECRET!,
            },
          }
        : {}),
      ...(googleEnabled
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID!,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
              prompt: "select_account" as const,
            },
          }
        : {}),
      ...(microsoftEnabled
        ? {
            microsoft: {
              clientId: process.env.MICROSOFT_CLIENT_ID!,
              clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
              tenantId: "common", // personal and work/school accounts
            },
          }
        : {}),
    },
    plugins: [
      // Turnstile on the endpoints a bot would hammer. Verified here, not on the site, so calling the API
      // directly gains nothing. Off only outside production when no secret is set (tests, local dev).
      ...(turnstileSecret
        ? [
            captcha({
              provider: "cloudflare-turnstile",
              secretKey: turnstileSecret,
              endpoints: [SEND_CODE_PATH],
            }),
          ]
        : []),
      emailOTP({
        otpLength: 6,
        expiresIn: SIGN_IN_CODE_MINUTES * 60,
        allowedAttempts: 5,
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type === "sign-in")
            await sendEmail("signInCode", email, { code: otp, minutes: SIGN_IN_CODE_MINUTES });
        },
      }),
      nextCookies(), // must be last
    ],
    databaseHooks: {
      user: {
        create: {
          // The one choke point every first sign-in goes through (email code, Google, Microsoft, GitHub).
          before: async (user) => {
            if (user.email && (await isBlockedEmail(user.email))) throw signUpRefused();
          },
          // Plan defaults to 'free' in the schema. Grant the free monthly credits (idempotent per period) and
          // give the user a referral code. Anything needing the request (AUP, first touch) is applied in
          // lib/auth/bootstrap.ts, which is also idempotent.
          after: async (user, ctx) => {
            try {
              await stampSignUp(user.id, ctx?.path, ctx?.body as SignUpBody | undefined);
              await getDatabase().withSystem("account.create", (tx) =>
                tx
                  .update(users)
                  .set({ referralCode: randomBytes(5).toString("hex") })
                  .where(and(eq(users.id, user.id), isNull(users.referralCode))),
              );
              await grantMonthly(user.id, "free", new Date());
              // Every sign-in method verifies the address (the email code itself, or the provider's verified email),
              // so the account starts verified: record it and send the welcome email (consent-gated, once).
              if (user.emailVerified) {
                await trackEvent("email_verified", { userId: user.id });
                await sendLifecycle("welcome", user.id).catch(() => {});
              }
            } catch (e) {
              console.error("account.create hook failed; bootstrap will retry", e);
            }
          },
        },
      },
    },
  });
}

interface SignUpBody {
  firstTouch?: unknown;
}

/** First sign-in: store the first-touch attribution the visitor consented to (sent with the email-code sign-in). */
async function stampSignUp(
  userId: string,
  path: string | undefined,
  body: SignUpBody | undefined,
): Promise<void> {
  const ft =
    body?.firstTouch && typeof body.firstTouch === "object"
      ? parseAttribution({ cookie: JSON.stringify(body.firstTouch) })
      : null;
  if (ft) await saveFirstTouch(userId, ft);
  const method =
    path === CODE_SIGN_IN_PATH ? "email_code" : path?.startsWith("/callback/") ? path.slice(10) : "other";
  await trackEvent("signup_completed", { userId, props: { method } });
}

/**
 * A separate Better Auth instance on its own Database: stands in for another Cloud Run instance in the tests that
 * prove rate limits are shared. Production code uses getAuth().
 */
export function createAuth(database: Database) {
  return build(database);
}

let instance: ReturnType<typeof build> | undefined;
/** Lazy so importing this module at build time needs no env. */
export function getAuth() {
  return (instance ??= build());
}
export type Auth = ReturnType<typeof getAuth>;
