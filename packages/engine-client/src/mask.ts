/**
 * Masking helpers. Masked values are what every non-vault table and the UI store/show.
 *  - credentials/tokens/keys: `len:N` (nothing of the value survives)
 *  - emails: `j***@acme.com` (first char of local part + domain)
 *  - other sensitive values: first/last chars kept, length-aware
 */
import { createHash } from "node:crypto";
import { isSecretType, type EntityType } from "./entities";

export function maskCredential(value: string): string {
  return `len:${[...value].length}`;
}

/** Contract G4 `value` form for a secret: `len:N sha256:<8-hex prefix>`. */
export function secretValueToken(value: string): string {
  const prefix = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `${maskCredential(value)} sha256:${prefix}`;
}

export function maskEmail(value: string): string {
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return maskPartial(value);
  const local = [...value.slice(0, at)];
  return `${local[0]}***@${value.slice(at + 1)}`;
}

/**
 * Keep the first and last chars, hide the middle; how much is kept scales with length so
 * short values never leak most of themselves.
 *  len <= 4: all hidden; 5-8: 1 + 1; 9-16: 2 + 2; longer: 3 + 3.
 */
export function maskPartial(value: string): string {
  const chars = [...value];
  const n = chars.length;
  if (n === 0) return "";
  if (n <= 4) return "*".repeat(n);
  const keep = n <= 8 ? 1 : n <= 16 ? 2 : 3;
  const hidden = Math.min(n - 2 * keep, 8);
  return chars.slice(0, keep).join("") + "*".repeat(hidden) + chars.slice(n - keep).join("");
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return maskPartial(value);
  return `${value.trim().startsWith("+") ? "+" : ""}***${digits.slice(-2)}`;
}

/** Display value for an entity: pre-masked when sensitive, unchanged for public indicator types. */
export function maskEntityValue(type: EntityType, value: string): string {
  if (isSecretType(type)) return maskCredential(value);
  switch (type) {
    case "EMAIL_ADDRESS":
      return maskEmail(value);
    case "XMPP_JID":
      return maskEmail(value);
    case "PHONE_NUMBER":
      return maskPhone(value);
    case "PERSON_NAME":
      return value
        .split(/\s+/)
        .map((w) => `${[...w][0] ?? ""}***`)
        .join(" ");
    default:
      return value;
  }
}
