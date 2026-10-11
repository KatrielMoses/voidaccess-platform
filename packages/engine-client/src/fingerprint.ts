import { createHmac } from "node:crypto";
import type { EntityType } from "./entities";

const CASE_INSENSITIVE: ReadonlySet<string> = new Set([
  "EMAIL_ADDRESS",
  "XMPP_JID",
  "DOMAIN",
  "ENS_DOMAIN",
  "URL",
  "ONION_URL",
  "PASTE_URL",
  "IP_ADDRESS",
  "IPV6_ADDRESS",
  "MAC_ADDRESS",
  "FILE_HASH_MD5",
  "FILE_HASH_SHA1",
  "FILE_HASH_SHA256",
  "ETHEREUM_ADDRESS",
  "ETH_ADDRESS",
  "CVE_NUMBER",
  "CVE",
  "TELEGRAM_HANDLE",
  "DISCORD_HANDLE",
  "THREAT_ACTOR_HANDLE",
  "THREAT_ACTOR",
  "RANSOMWARE_GROUP",
  "MALWARE_FAMILY",
  "ORGANIZATION_NAME",
  "PERSON_NAME",
]);

/** Canonical form used for fingerprints: NFKC, trimmed, whitespace collapsed, lowercased where case carries no meaning. */
export function normalizeValue(type: EntityType | string, value: string): string {
  let v = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (CASE_INSENSITIVE.has(type)) v = v.toLowerCase();
  if (type === "PHONE_NUMBER") v = v.replace(/[^\d+]/g, "");
  if (type === "URL" || type === "ONION_URL") v = v.replace(/\/+$/, "");
  return v;
}

/** Stable HMAC-SHA256 fingerprint (hex). Same (secret, type, normalised value) always yields the same output. */
export function fingerprint(secret: string, type: EntityType | string, value: string): string {
  return createHmac("sha256", secret)
    .update(`${type}\u0000${normalizeValue(type, value)}`)
    .digest("hex");
}
