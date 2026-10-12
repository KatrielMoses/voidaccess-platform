/**
 * Blocked e-mail domains (H1-3): `blocked_email_domains` (system-only; the admin UI in P6 manages it).
 * An address is refused when its domain, or any parent domain, is listed: a block on `mailinator.com` also covers
 * `eu.mailinator.com`.
 */
import { domainToASCII } from "node:url";
import { sql } from "drizzle-orm";
import { getDatabase, type Database } from "@voidaccess/db";
import { APIError } from "better-auth/api";

/** The single message every refused sign-up gets, whatever the reason: it must not reveal which rule fired. */
export const SIGN_UP_REFUSED_MESSAGE = "We couldn't create that account. Check your details and try again.";

export function signUpRefused(): APIError {
  return new APIError("BAD_REQUEST", { message: SIGN_UP_REFUSED_MESSAGE });
}

/** `a@b.c.example.` -> ["b.c.example", "c.example", "example"] (lower-case, ASCII/punycode, no trailing dot). */
export function emailDomainCandidates(email: string): string[] {
  const at = email.lastIndexOf("@");
  if (at < 0) return [];
  const host = domainToASCII(
    email
      .slice(at + 1)
      .trim()
      .toLowerCase()
      .replace(/\.+$/, ""),
  );
  if (!host) return [];
  const labels = host.split(".");
  return labels.map((_, i) => labels.slice(i).join("."));
}

export async function isBlockedEmail(email: string, database: Database = getDatabase()): Promise<boolean> {
  const candidates = emailDomainCandidates(email);
  if (candidates.length === 0) return false;
  const res = await database.withSystem(
    "auth.blocked-domain",
    (tx) =>
      tx.execute<{ hit: boolean }>(
        sql`select exists (select 1 from blocked_email_domains
          where domain in (${sql.join(
            candidates.map((c) => sql`${c}`),
            sql`, `,
          )})) as hit`,
      ),
    { audit: false },
  );
  return res.rows[0]?.hit === true;
}

/** Is there already an account for this address? (Existing accounts keep signing in; only new ones are refused.) */
export async function accountExists(email: string, database: Database = getDatabase()): Promise<boolean> {
  const res = await database.withSystem(
    "auth.blocked-domain",
    (tx) =>
      tx.execute<{ hit: boolean }>(
        sql`select exists (select 1 from users where lower(email) = lower(${email})) as hit`,
      ),
    { audit: false },
  );
  return res.rows[0]?.hit === true;
}
