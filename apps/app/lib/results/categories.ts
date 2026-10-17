/**
 * Sidebar groups for the results workspace (P9-3): every entity type maps to exactly one group, in a fixed order.
 * The one place this mapping lives; unit-tested against ENTITY_TYPES. Unknown types (a newer engine) fall into Other.
 */
import { ENTITY_TYPES, entityCategory, type EntityType } from "@voidaccess/engine-client";
import { glyphFor, type ShapeName } from "./glyphs";

export const GROUPS = [
  { id: "onion", label: "Onion links" },
  { id: "web", label: "URLs & domains" },
  { id: "ip", label: "IP addresses" },
  { id: "cve", label: "CVEs & exploits" },
  { id: "actors", label: "Actors & groups" },
  { id: "malware", label: "Malware & hashes" },
  { id: "crypto", label: "Crypto wallets" },
  { id: "credentials", label: "Credentials" },
  { id: "contacts", label: "Contacts" },
  { id: "orgs", label: "Organizations" },
  { id: "attack", label: "ATT&CK techniques" },
  { id: "other", label: "Other" },
] as const;
export type GroupId = (typeof GROUPS)[number]["id"];
export const GROUP_LABEL = Object.fromEntries(GROUPS.map((g) => [g.id, g.label])) as Record<GroupId, string>;

const EXPLICIT: Partial<Record<EntityType, GroupId>> = {
  ONION_URL: "onion",
  URL: "web",
  DOMAIN: "web",
  ENS_DOMAIN: "web",
  PASTE_URL: "web",
  IPFS_CID: "web",
  IP_ADDRESS: "ip",
  IPV6_ADDRESS: "ip",
  MAC_ADDRESS: "ip",
  CVE_NUMBER: "cve",
  CVE: "cve",
  EXPLOIT_DB_ID: "cve",
  THREAT_ACTOR: "actors",
  THREAT_ACTOR_HANDLE: "actors",
  RANSOMWARE_GROUP: "actors",
  MITRE_TECHNIQUE: "attack",
  MITRE_TACTIC: "attack",
  EMAIL_ADDRESS: "contacts",
  PHONE_NUMBER: "contacts",
  PERSON_NAME: "contacts",
  PGP_KEY_BLOCK: "contacts",
  ORGANIZATION_NAME: "orgs",
  LOCATION: "other",
  DATE: "other",
};

/** The sidebar group of an entity type. */
export function groupOf(type: string): GroupId {
  const explicit = EXPLICIT[type as EntityType];
  if (explicit) return explicit;
  if (!(ENTITY_TYPES as readonly string[]).includes(type)) return "other";
  switch (entityCategory(type as EntityType)) {
    case "malware":
      return "malware"; // MALWARE_FAMILY, FILE_HASH_*, YARA_RULE, NUCLEI_TEMPLATE
    case "crypto":
      return "crypto"; // *_ADDRESS wallets, CRYPTO_SEED_PHRASE
    case "credential":
      return "credentials";
    case "messaging":
      return "contacts"; // messaging handles
    default:
      return "other";
  }
}

/** A representative glyph for a group (the shape most of its types use in the graph). */
export function groupShape(id: GroupId): ShapeName {
  const sample: Record<GroupId, string> = {
    onion: "ONION_URL",
    web: "DOMAIN",
    ip: "IP_ADDRESS",
    cve: "CVE_NUMBER",
    actors: "RANSOMWARE_GROUP",
    malware: "MALWARE_FAMILY",
    crypto: "BITCOIN_ADDRESS",
    credentials: "API_KEY",
    contacts: "EMAIL_ADDRESS",
    orgs: "ORGANIZATION_NAME",
    attack: "MITRE_TECHNIQUE",
    other: "DATE",
  };
  return glyphFor(sample[id]).shape;
}
