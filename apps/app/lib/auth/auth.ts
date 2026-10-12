import { and, eq, isNull } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { randomBytes } from "node:crypto";
import { sendEmail } from "@voidaccess/emails";
import { grantMonthly, getDatabase } from "@voidaccess/db";
import { accounts, sessions, users, verifications } from "@voidaccess/db/schema";
import { getAuthDb } from "./auth-db";
import { trackEvent } from "@/lib/analytics";
import { AUTH_RATE_LIMITS } from "../limits-auth";

const isProd = process.env.NODE_ENV === "production";
const appUrl = process.env.APP_URL ?? "http://localhost:3000";

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (s) return s;
  if (isProd) throw new Error("BETTER_AUTH_SECRET is required in production");
  return "dev-only-secret-dev-only-secret-dev-only-secret";
}

export const githubEnabled = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);

function build() {
  return betterAuth({
    baseURL: appUrl,
    secret: secret(),
    trustedOrigins: [appUrl],
    database: drizzleAdapter(getAuthDb().db, {
      provider: "pg",
      usePlural: true,
      schema: { users, sessions, accounts, verifications },
    }),
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: isProd,
      // httpOnly + SameSite=Lax; Secure in production. Session tokens are never readable by JavaScript.
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: isProd },
      disableCSRFCheck: false, // Origin / Fetch-Metadata checks stay on
    },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, window: 60, max: 100, storage: "memory", customRules: AUTH_RATE_LIMITS },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail("passwordReset", user.email, { name: user.name, url });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      afterEmailVerification: async (user) => {
        await trackEvent("email_verified", { userId: user.id });
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
          // Plan defaults to 'free' in the schema. Grant the free monthly credits (idempotent per period) and
          // give the user a referral code. Anything needing the request (AUP, first touch) is applied in
          // lib/auth/bootstrap.ts, which is also idempotent.
          after: async (user) => {
            try {
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

let instance: ReturnType<typeof build> | undefined;
/** Lazy so importing this module at build time needs no env. */
export function getAuth() {
  return (instance ??= build());
}
export type Auth = ReturnType<typeof getAuth>;
