import { resolve } from "../facts";
import { SITE_URL } from "../site";
import { email as emailCopy } from "@content/waitlist";
import { getDb } from "./db";
import { getMailer } from "./email";
import { getRateLimiter } from "./ratelimit";
import type { JoinDeps } from "./service";
import { drizzleStore } from "./store";
import { verifyTurnstile } from "./turnstile";

/** Wires the real dependencies for the route handlers. Tests build JoinDeps by hand instead. */
export async function runtimeDeps(): Promise<JoinDeps> {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) throw new Error("IP_HASH_SALT is not set");
  return {
    store: drizzleStore(await getDb()),
    mailer: getMailer(),
    limiter: await getRateLimiter(),
    verifyTurnstile,
    ipSalt: salt,
    siteUrl: SITE_URL,
    confirmationMail: (link) => ({
      subject: resolve(emailCopy.subject),
      text: resolve(emailCopy.body).replace("{link}", link),
    }),
  };
}
