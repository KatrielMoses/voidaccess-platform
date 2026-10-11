import { z } from "zod";

/**
 * Entity taxonomy. Derived from the engine's extractor taxonomy
 * (voidaccess/extractor/normalizer.py TYPE_PRIORITY + regex_patterns.py + NER/LLM types),
 * as emitted in `cli_payload.entities[].entity_type` in the E0 baseline runs.
 * UPPER_SNAKE names are kept verbatim so the Python runner can pass them through unchanged.
 */
export const ENTITY_CATEGORIES = [
  "threat",
  "malware",
  "vulnerability",
  "indicator",
  "network",
  "crypto",
  "credential",
  "messaging",
  "identity",
  "org",
  "other",
] as const;
export type EntityCategory = (typeof ENTITY_CATEGORIES)[number];

const TYPE_CATEGORY = {
  // threat actors
  RANSOMWARE_GROUP: "threat",
  THREAT_ACTOR: "threat",
  THREAT_ACTOR_HANDLE: "threat",
  MITRE_TECHNIQUE: "threat",
  MITRE_TACTIC: "threat",
  // malware
  MALWARE_FAMILY: "malware",
  FILE_HASH_MD5: "malware",
  FILE_HASH_SHA1: "malware",
  FILE_HASH_SHA256: "malware",
  YARA_RULE: "malware",
  NUCLEI_TEMPLATE: "malware",
  // vulnerabilities
  CVE_NUMBER: "vulnerability",
  CVE: "vulnerability",
  EXPLOIT_DB_ID: "vulnerability",
  // network
  IP_ADDRESS: "network",
  IPV6_ADDRESS: "network",
  MAC_ADDRESS: "network",
  DOMAIN: "network",
  ENS_DOMAIN: "network",
  URL: "network",
  ONION_URL: "network",
  PASTE_URL: "network",
  IPFS_CID: "network",
  // crypto
  BITCOIN_ADDRESS: "crypto",
  BITCOIN_CASH_ADDRESS: "crypto",
  ETHEREUM_ADDRESS: "crypto",
  ETH_ADDRESS: "crypto",
  MONERO_ADDRESS: "crypto",
  LITECOIN_ADDRESS: "crypto",
  ZCASH_ADDRESS: "crypto",
  DOGECOIN_ADDRESS: "crypto",
  XRP_ADDRESS: "crypto",
  SOLANA_ADDRESS: "crypto",
  TRON_ADDRESS: "crypto",
  DASH_ADDRESS: "crypto",
  CRYPTO_SEED_PHRASE: "crypto",
  // credentials and secrets
  API_KEY: "credential",
  AWS_ACCESS_KEY: "credential",
  AWS_SECRET_KEY: "credential",
  GITHUB_TOKEN: "credential",
  SLACK_TOKEN: "credential",
  DISCORD_TOKEN: "credential",
  JWT_TOKEN: "credential",
  GOOGLE_API_KEY: "credential",
  STRIPE_KEY: "credential",
  STEALER_LOG_ENTRY: "credential",
  COMBO_LIST_ENTRY: "credential",
  // messaging handles
  TELEGRAM_HANDLE: "messaging",
  DISCORD_HANDLE: "messaging",
  XMPP_JID: "messaging",
  TOX_ID: "messaging",
  SESSION_ID: "messaging",
  MATRIX_HANDLE: "messaging",
  WIRE_HANDLE: "messaging",
  ICQ_NUMBER: "messaging",
  WICKR_ID: "messaging",
  // identity
  EMAIL_ADDRESS: "identity",
  PHONE_NUMBER: "identity",
  PERSON_NAME: "identity",
  PGP_KEY_BLOCK: "identity",
  // organisations and context
  ORGANIZATION_NAME: "org",
  LOCATION: "other",
  DATE: "other",
} as const satisfies Record<string, EntityCategory>;

export const ENTITY_TYPES = Object.keys(TYPE_CATEGORY) as [
  keyof typeof TYPE_CATEGORY,
  ...(keyof typeof TYPE_CATEGORY)[],
];

export const EntityType = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityType>;

export function entityCategory(type: EntityType): EntityCategory {
  return TYPE_CATEGORY[type];
}

/** Types whose raw value is a secret: never leave the engine, shown as `len:N` (contract G4). */
export function isSecretType(type: EntityType): boolean {
  return TYPE_CATEGORY[type] === "credential" || type === "CRYPTO_SEED_PHRASE";
}

/** Types flagged `sensitive` in a bundle: secrets, emails, phones, personal names (contract G4). */
export function isSensitiveType(type: EntityType): boolean {
  return isSecretType(type) || type === "EMAIL_ADDRESS" || type === "PHONE_NUMBER" || type === "PERSON_NAME";
}

export const Depth = z.enum(["quick", "standard", "deep"]);
export type Depth = z.infer<typeof Depth>;
