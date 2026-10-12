/** Cron auth for the billing routes: identical rules to P2's watchdog (shared secret in dev, Cloud Scheduler OIDC in production), with this route's own audience. */
import { timingSafeEqual } from "node:crypto";
import { getEnv } from "../../env";
import { verifyGoogleOidc, type JwksProvider } from "../runs/cron-auth";

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function authorizeBillingCron(req: Request, jwks?: JwksProvider): Promise<boolean> {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return false;
  const token = m[1]!;
  const env = getEnv();
  if (env.NODE_ENV !== "production" && env.CRON_SHARED_SECRET && same(token, env.CRON_SHARED_SECRET))
    return true;
  if (env.CRON_OIDC_EMAIL && token.split(".").length === 3) {
    const base = env.APP_URL.replace(/\/$/, "");
    return verifyGoogleOidc(token, {
      audiences: [base, `${base}${new URL(req.url).pathname}`],
      email: env.CRON_OIDC_EMAIL,
      jwks,
    });
  }
  return false;
}
