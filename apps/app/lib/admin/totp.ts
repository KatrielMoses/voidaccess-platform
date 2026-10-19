/**
 * TOTP (RFC 6238 over RFC 4226 HOTP) with node:crypto only, compatible with Google Authenticator and friends:
 * HMAC-SHA1, 30-second steps, 6 digits, a base32 secret of 20 random bytes. Verification accepts the current step
 * and one on either side (clock drift), never a step at or before the last one accepted (replay), and compares in
 * constant time.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;
export const TOTP_ISSUER = "VoidAccess";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new secret: 20 random bytes (160 bits, the RFC 4226 recommendation), base32 without padding (32 chars). */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 4226 HOTP. `key` is the raw secret; `algorithm` exists for the RFC 6238 SHA-256/512 vectors only. */
export function hotp(
  key: Buffer,
  counter: number,
  digits = TOTP_DIGITS,
  algorithm: "sha1" | "sha256" | "sha512" = "sha1",
): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algorithm, key).update(msg).digest();
  const off = h[h.length - 1]! & 0xf;
  const bin =
    ((h[off]! & 0x7f) << 24) |
    ((h[off + 1]! & 0xff) << 16) |
    ((h[off + 2]! & 0xff) << 8) |
    (h[off + 3]! & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const stepAt = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

/** The code for a base32 secret at a time (for tests and the e2e; the server only verifies). */
export function totpAt(secretB32: string, nowMs: number): string {
  return hotp(base32Decode(secretB32), stepAt(nowMs));
}

/** Constant-time comparison of two codes (both are validated to TOTP_DIGITS digits first). */
const sameCode = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The time step a code matches (current step +/- TOTP_WINDOW) that is later than `lastStep`, or null. Every
 * candidate step is computed and compared, so the time taken doesn't depend on which one matched.
 */
export function matchTotp(
  secretB32: string,
  code: string,
  nowMs: number,
  lastStep: number | null = null,
): number | null {
  const c = String(code).replace(/\s+/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secretB32);
  const now = stepAt(nowMs);
  let found: number | null = null;
  for (let s = now - TOTP_WINDOW; s <= now + TOTP_WINDOW; s++) {
    const ok = sameCode(hotp(key, s), c);
    if (ok && found === null && (lastStep === null || s > lastStep)) found = s;
  }
  key.fill(0);
  return found;
}

/** Same code but for a step at or before the last accepted one: a replay (reported separately in the audit). */
export function isReplay(secretB32: string, code: string, nowMs: number, lastStep: number | null): boolean {
  if (lastStep === null) return false;
  const c = String(code).replace(/\s+/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const key = base32Decode(secretB32);
  const now = stepAt(nowMs);
  let hit = false;
  for (let s = now - TOTP_WINDOW; s <= now + TOTP_WINDOW; s++)
    if (sameCode(hotp(key, s), c) && s <= lastStep) hit = true;
  key.fill(0);
  return hit;
}

/** otpauth:// URI for the authenticator app (issuer "VoidAccess", account = the email). */
export function otpauthUri(secretB32: string, account: string, issuer = TOTP_ISSUER): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const q = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** "ABCD EFGH ..." for manual entry. */
export const groupSecret = (s: string) => s.match(/.{1,4}/g)?.join(" ") ?? s;
