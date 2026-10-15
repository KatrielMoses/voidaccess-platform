import { glyphFor, type Glyph } from "./glyphs";

export interface TypeStyle {
  label: string;
  glyph: Glyph;
}

const LABELS: Record<string, string> = {
  RANSOMWARE_GROUP: "Ransomware group",
  THREAT_ACTOR_HANDLE: "Actor handle",
  THREAT_ACTOR: "Threat actor",
  ONION_URL: "Onion address",
  IP_ADDRESS: "IP address",
  IPV6_ADDRESS: "IPv6 address",
  FILE_HASH_MD5: "MD5",
  FILE_HASH_SHA1: "SHA-1",
  FILE_HASH_SHA256: "SHA-256",
  CVE_NUMBER: "CVE",
  MITRE_TECHNIQUE: "ATT&CK technique",
  MITRE_TACTIC: "ATT&CK tactic",
  ORGANIZATION_NAME: "Organization",
  EMAIL_ADDRESS: "Email",
  PHONE_NUMBER: "Phone",
  PERSON_NAME: "Person",
  BITCOIN_ADDRESS: "Bitcoin wallet",
  ETHEREUM_ADDRESS: "Ethereum wallet",
  MONERO_ADDRESS: "Monero wallet",
  TELEGRAM_HANDLE: "Telegram",
  MALWARE_FAMILY: "Malware",
  COMBO_LIST_ENTRY: "Combo-list entry",
  STEALER_LOG_ENTRY: "Stealer-log entry",
  API_KEY: "API key",
  PASTE_URL: "Paste link",
};

export const typeLabel = (type: string) =>
  LABELS[type] ??
  type
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** An entity type's label and glyph. No colour: kinds are told apart by text and shape (design.md §3). */
export function typeStyle(type: string): TypeStyle {
  return { label: typeLabel(type), glyph: glyphFor(type) };
}

export const EDGE_COOCCURRENCE = "CO_APPEARED_ON";
export const isCooccurrence = (t: string) => t === EDGE_COOCCURRENCE;
/** User-facing relationship wording: never "victim of" or "attributed to". */
export const edgeKindLabel = (t: string) => (isCooccurrence(t) ? "co-occurrence" : "typed (lead)");
export const edgeTypeLabel = (t: string) =>
  isCooccurrence(t) ? "co-occurrence" : t.toLowerCase().replaceAll("_", " ");
export const EDGE_DISCLAIMER =
  "Edges are leads extracted from co-mentions in sources, not verified facts. Two entities appearing together does not mean one acted on the other.";

export const UPGRADE_URL = "/billing";
