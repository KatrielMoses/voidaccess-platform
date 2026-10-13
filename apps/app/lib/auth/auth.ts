import { and, eq, isNull } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { captcha, magicLink } from "better-auth/plugins";
import { randomBytes } from "node:crypto";
import { sendEmail } from "@voidaccess/emails";
import { grantMonthly, getDatabase, type Database } from "@voidaccess/db";
import { accounts, rateLimits, sessions, users, verifications } from "@voidaccess/db/schema";
import { getAuthDb } from "./auth-db";
import { acceptAup, saveFirstTouch } from "./bootstrap";
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

/** Email sign-up happens on the site; the server is the authority on the AUP, never the form. */
const SIGN_UP_PATH = "/sign-up/email";
const MAGIC_LINK_PATH = "/sign-in/magic-link";

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
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = ctx.body as { aupAccepted?: unknown; email?: unknown } | undefined;
        const email = typeof body?.email === "string" ? body.email : null;
        if (ctx.path === MAGIC_LINK_PATH) {
          // A magic link for an unknown address creates the account, so it is a sign-up: refuse blocked domains
          // for new addresses with the same generic error. Existing accounts on such a domain still sign in.
          if (email && (await isBlockedEmail(email)) && !(await accountExists(email))) throw signUpRefused();
          return;
        }
        if (ctx.path !== SIGN_UP_PATH) return;
        if (body?.aupAccepted !== true) {
          throw new APIError("BAD_REQUEST", {
            message: "You must accept the Acceptable Use Policy to continue",
          });
        }
        if (email && (await isBlockedEmail(email))) throw signUpRefused();
      }),
    },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
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
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      // The reset form lives on the site; the emailed link carries the token there.
      sendResetPassword: async ({ user, token }) => {
        const url = `${siteUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
        await sendEmail("passwordReset", user.email, { name: user.name, url });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      afterEmailVerification: async (user) => {
        await trackEvent("email_verified", { userId: user.id });
        await sendLifecycle("welcome", user.id).catch(() => {}); // consent-gated and once per user (lib/lifecycle)
      },
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail("verifyEmail", user.email, { name: user.name, url });
      },
    },
    user: {
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          await sendEmail("changeEmail", newEmail, { name: user.name, url });
        },
      },
    },
    socialProviders: githubEnabled
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID!,
            clientSecret: process.env.GITHUB_CLIENT_SECRET!,
          },
        }
      : {},
    plugins: [
      // Turnstile on the endpoints a bot would hammer. Verified here, not on the site, so calling the API
      // directly gains nothing. Off only outside production when no secret is set (tests, local dev).
      ...(turnstileSecret
        ? [
            captcha({
              provider: "cloudflare-turnstile",
              secretKey: turnstileSecret,
              endpoints: [SIGN_UP_PATH, "/sign-in/magic-link", "/request-password-reset"],
            }),
          ]
        : []),
      magicLink({
        expiresIn: 300,
        sendMagicLink: async ({ email, url }) => {
          await sendEmail("magicLink", email, { url, minutes: 5 });
        },
      }),
      nextCookies(), // must be last
    ],
    databaseHooks: {
      user: {
        create: {
          // The one choke point every sign-up path goes through (email, magic link, GitHub): last line of defence.
          before: async (user) => {
            if (user.email && (await isBlockedEmail(user.email))) throw signUpRefused();
          },
          // Plan defaults to 'free' in the schema. Grant the free monthly credits (idempotent per period) and
          // give the user a referral code. Anything needing the request (AUP, first touch) is applied in
          // lib/auth/bootstrap.ts, which is also idempotent.
          after: async (user, ctx) => {
            try {
              if (ctx?.path === SIGN_UP_PATH) await stampSignUp(user.id, ctx.body as SignUpBody | undefined);
              await getDatabase().withSystem("account.create", (tx) =>
                tx
                  .update(users)
                  .set({ referralCode: randomBytes(5).toString("hex") })
                  .where(and(eq(users.id, user.id), isNull(users.referralCode))),
              );
              await grantMonthly(user.id, "free", new Date());
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
  aupAccepted?: unknown;
  firstTouch?: unknown;
}

/** Email sign-up: store the AUP timestamp and the first-touch the visitor consented to (sent in the body). */
async function stampSignUp(userId: string, body: SignUpBody | undefined): Promise<void> {
  if (body?.aupAccepted === true) await acceptAup(userId);
  const ft =
    body?.firstTouch && typeof body.firstTouch === "object"
      ? parseAttribution({ cookie: JSON.stringify(body.firstTouch) })
      : null;
  if (ft) await saveFirstTouch(userId, ft);
  await trackEvent("signup_completed", { userId, props: { method: "password" } });
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
