/**
 * Authentication for /api/cron/*.
 *  - development/test: `Authorization: Bearer <CRON_SHARED_SECRET>` (never accepted in production).
 *  - production: a Google OIDC ID token minted by Cloud Scheduler for the va-app service account:
 *    RS256 signature checked against Google's published JWKS, issuer accounts.google.com, audience APP_URL,
 *    not expired, email == CRON_OIDC_EMAIL and email_verified. Implemented with node:crypto because
 *    google-auth-library is not a dependency of apps/app (the lead can swap it in later).
 */
import { createPublicKey, createVerify, timingSafeEqual } from "node:crypto";
import { getEnv } from "../../env";

type Jwk = { kid?: string; kty: string; n?: string; e?: string; [k: string]: unknown };
export type JwksProvider = () => Promise<Jwk[]>;

const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";
let certCache: { keys: Jwk[]; at: number } | undefined;

const googleJwks: JwksProvider = async () => {
  if (certCache && Date.now() - certCache.at < 3_600_000) return certCache.keys;
  const res = await fetch(GOOGLE_CERTS);
  if (!res.ok) throw new Error("could not fetch Google certs");
  const body = (await res.json()) as { keys: Jwk[] };
  certCache = { keys: body.keys, at: Date.now() };
  return body.keys;
};

const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function verifyGoogleOidc(
  token: string,
  opts: { audiences: string[]; email: string; jwks?: JwksProvider; nowSeconds?: number },
): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [h, p, s] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg?: string; kid?: string };
    if (header.alg !== "RS256") return false;
    const keys = await (opts.jwks ?? googleJwks)();
    const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
    if (!jwk) return false;
    const key = createPublicKey({ key: jwk as never, format: "jwk" });
    const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(key, Buffer.from(s, "base64url"));
    if (!ok) return false;
    const c = JSON.parse(Buffer.from(p, "base64url").toString()) as {
      iss?: string;
      aud?: string;
      exp?: number;
      email?: string;
      email_verified?: boolean;
    };
    const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
    return (
      (c.iss === "https://accounts.google.com" || c.iss === "accounts.google.com") &&
      typeof c.aud === "string" &&
      opts.audiences.includes(c.aud) &&
      typeof c.exp === "number" &&
      c.exp > now &&
      c.email === opts.email &&
      c.email_verified === true
    );
  } catch {
    return false;
  }
}

export async function authorizeCron(req: Request, jwks?: JwksProvider): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) return false;
  const token = m[1]!;
  const env = getEnv();
  if (env.NODE_ENV !== "production" && env.CRON_SHARED_SECRET && eq(token, env.CRON_SHARED_SECRET))
    return true;
  if (env.CRON_OIDC_EMAIL && token.split(".").length === 3) {
    const base = env.APP_URL.replace(/\/$/, "");
    return verifyGoogleOidc(token, {
      audiences: [base, `${base}/api/cron/watchdog`],
      email: env.CRON_OIDC_EMAIL,
      jwks,
    });
  }
  return false;
}
