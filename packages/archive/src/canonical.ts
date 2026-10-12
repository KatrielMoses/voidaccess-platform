/**
 * Deterministic canonical identity for archived entities, ported from the engine's identity rules
 * (extractor/normalizer.canonicalize_entity_value, extractor/identity.py) and extended with refanging.
 * Two sightings of the same thing, written differently, must land on the same archive entity.
 * Sensitive types never get a canonical value: their identity is the HMAC fingerprint.
 */
import { normalizeValue } from "@voidaccess/engine-client";
import { aliasFor } from "./aliases";

export interface Canon {
  /** archive entity type (alias groups are unified under the group's declared type) */
  type: string;
  /** canonical value, null for sensitive entities (identity is the fingerprint) */
  canonical: string | null;
  display: string;
}

const NAME_TYPES = new Set([
  "RANSOMWARE_GROUP",
  "THREAT_ACTOR",
  "THREAT_ACTOR_HANDLE",
  "MALWARE_FAMILY",
  "ORGANIZATION_NAME",
]);
const ALIAS_TYPES = new Set(["RANSOMWARE_GROUP", "THREAT_ACTOR", "THREAT_ACTOR_HANDLE", "MALWARE_FAMILY"]);
const HANDLE_TYPES = new Set([
  "TELEGRAM_HANDLE",
  "DISCORD_HANDLE",
  "MATRIX_HANDLE",
  "WIRE_HANDLE",
  "SESSION_ID",
  "TOX_ID",
  "WICKR_ID",
  "ICQ_NUMBER",
]);
const HASH_TYPES = new Set(["FILE_HASH_MD5", "FILE_HASH_SHA1", "FILE_HASH_SHA256"]);
const WALLET_TYPES = new Set([
  "BITCOIN_ADDRESS",
  "BITCOIN_CASH_ADDRESS",
  "ETHEREUM_ADDRESS",
  "ETH_ADDRESS",
  "MONERO_ADDRESS",
  "LITECOIN_ADDRESS",
  "ZCASH_ADDRESS",
  "DOGECOIN_ADDRESS",
  "XRP_ADDRESS",
  "SOLANA_ADDRESS",
  "TRON_ADDRESS",
  "DASH_ADDRESS",
]);

/** Undo the common "defanging" analysts apply: hxxp, [.], (.), [:] and the like. */
export function refang(s: string): string {
  return s
    .trim()
    .replace(/^hxxp/i, "http")
    .replace(/\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\)/gi, ".")
    .replace(/\[:\]|\[:\/\/\]/g, (m) => (m === "[:]" ? ":" : "://"))
    .replace(/\[at\]|\(at\)/gi, "@");
}

/** Fold a name: NFKD, ASCII only, lower case, no separators or punctuation ("Black-Cat" and "black cat" agree). */
export function foldName(s: string): string {
  return (
    s
      .normalize("NFKD")
      // eslint-disable-next-line no-control-regex -- strips every non-ASCII character
      .replace(/[^\x00-\x7F]/g, "")
      .toLowerCase()
      .replace(/[\s\-_.]/g, "")
      .replace(/[^\w]/g, "")
  );
}

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "or", "ne"]);

/** The independence key of a source: the registrable domain for clearnet, the whole host for onion services. */
export function hostOf(host: string): string {
  const h = host
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (
    h.endsWith(".onion") ||
    h.endsWith(".i2p") ||
    /^[\d.]+$/.test(h) ||
    h.includes(":") ||
    h.startsWith("urn:")
  )
    return h;
  const labels = h.split(".");
  if (labels.length <= 2) return h;
  const tld = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  return tld.length === 2 && SECOND_LEVEL.has(second)
    ? labels.slice(-3).join(".")
    : labels.slice(-2).join(".");
}

export interface CanonUrl {
  /** scheme-less, host lower-cased and without www., no fragment, no tracking parameters, no trailing slash */
  key: string;
  host: string;
}

export function canonicalUrl(raw: string): CanonUrl | null {
  let s = refang(raw);
  if (!s) return null;
  if (s.startsWith("urn:"))
    return { key: s.toLowerCase(), host: s.toLowerCase().split(":").slice(0, 3).join(":") };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!host) return null;
    const port = u.port && !["80", "443"].includes(u.port) ? `:${u.port}` : "";
    const params = [...u.searchParams.entries()].filter(([k]) => !/^utm_|^fbclid$|^gclid$/i.test(k));
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    const path = u.pathname.replace(/\/+$/, "");
    return { key: `${host}${port}${path}${query}`, host: hostOf(host) };
  } catch {
    return null;
  }
}

/** Legal-form words that don't distinguish one organisation from another ("Northwind Traders Inc" is "Northwind Traders"). */
const LEGAL_SUFFIX = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "gmbh",
  "ag",
  "sa",
  "bv",
  "nv",
  "pty",
  "lp",
  "llp",
  "srl",
  "sas",
  "spa",
  "oy",
  "ab",
  "as",
  "kk",
]);

export function stripLegalSuffix(name: string): string {
  const tokens = name.split(/[^\p{L}\p{N}&]+/u).filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIX.has(tokens[tokens.length - 1]!.toLowerCase())) tokens.pop();
  return tokens.join(" ");
}

function canonicalName(type: string, value: string): { canonical: string; type: string; display: string } {
  const folded = foldName(type === "ORGANIZATION_NAME" ? stripLegalSuffix(value) : value);
  if (ALIAS_TYPES.has(type)) {
    const hit = aliasFor(folded);
    if (hit) return { canonical: hit.canonical, type: hit.type, display: hit.display };
  }
  return { canonical: folded || value.trim().toLowerCase(), type, display: value.trim() };
}

/** Canonical form of a non-sensitive entity. Returns null when the value is unusable. */
export function canonicalize(type: string, rawValue: string): Canon | null {
  const raw = rawValue.trim();
  if (!raw) return null;
  if (NAME_TYPES.has(type)) {
    const c = canonicalName(type, raw);
    return { type: c.type, canonical: c.canonical, display: c.display };
  }
  if (type === "DOMAIN" || type === "ENS_DOMAIN") {
    const v = refang(raw)
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/\.$/, "");
    return { type, canonical: v, display: v };
  }
  if (type === "URL" || type === "PASTE_URL" || type === "ONION_URL") {
    const u = canonicalUrl(raw);
    if (!u) return null;
    return { type, canonical: u.key, display: u.key };
  }
  if (type === "IP_ADDRESS" || type === "IPV6_ADDRESS") {
    const v = refang(raw).toLowerCase();
    return { type, canonical: v, display: v };
  }
  if (HASH_TYPES.has(type)) return { type, canonical: raw.toLowerCase(), display: raw.toLowerCase() };
  if (type === "CVE_NUMBER" || type === "CVE") {
    const m = /CVE[-‐-―\s]?(\d{4})[-‐-―\s]?(\d{4,7})/i.exec(raw);
    const v = m ? `CVE-${m[1]}-${m[2]}` : raw.toUpperCase();
    return { type: "CVE_NUMBER", canonical: v, display: v };
  }
  if (type === "MITRE_TECHNIQUE" || type === "MITRE_TACTIC") {
    const v = raw.toUpperCase().replace(/\s+/g, "");
    return { type, canonical: v, display: v };
  }
  if (type === "EXPLOIT_DB_ID") {
    const v = raw.replace(/\D/g, "");
    return v ? { type, canonical: v, display: v } : null;
  }
  if (WALLET_TYPES.has(type)) {
    const lower =
      raw.startsWith("0x") ||
      /^(bc1|tb1)/i.test(raw) ||
      /^bitcoincash:/i.test(raw) ||
      raw.startsWith("zs1") ||
      (raw.startsWith("4") && (raw.length === 95 || raw.length === 106)); // the engine's Monero rule
    const v = lower ? raw.toLowerCase() : raw;
    return { type, canonical: v, display: raw };
  }
  if (HANDLE_TYPES.has(type)) {
    const v = raw.normalize("NFKC").replace(/^@+/, "").toLowerCase();
    return { type, canonical: v, display: `@${v}` };
  }
  const v = normalizeValue(type, raw);
  return { type, canonical: v, display: raw };
}
