/**
 * Callback signing (job -> platform).
 *
 * Contract: `X-VA-Signature: sha256=<hex HMAC(secret, raw body)>` plus `X-VA-Run`, `X-VA-Seq`.
 * Replay protection (added): `X-VA-Timestamp: <unix seconds>`, and the signed material becomes
 *
 *     HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 *
 * i.e. the decimal timestamp, a dot, then the exact raw body bytes. The verifier rejects
 * timestamps more than 300 s from its clock (either direction) and compares in constant time.
 * Platform-side dedupe on (run_id, seq) remains the replay guard within the skew window.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const HEADER_RUN = "X-VA-Run";
export const HEADER_SEQ = "X-VA-Seq";
export const HEADER_SIGNATURE = "X-VA-Signature";
export const HEADER_TIMESTAMP = "X-VA-Timestamp";
export const MAX_SKEW_SECONDS = 300;
const SIG_PREFIX = "sha256=";

export type CallbackHeaders = Record<
  typeof HEADER_RUN | typeof HEADER_SEQ | typeof HEADER_SIGNATURE | typeof HEADER_TIMESTAMP,
  string
>;

export function computeSignature(
  secret: string,
  timestamp: string | number,
  rawBody: string | Uint8Array,
): string {
  const h = createHmac("sha256", secret);
  h.update(`${timestamp}.`);
  h.update(rawBody);
  return SIG_PREFIX + h.digest("hex");
}

export interface SignOptions {
  secret: string;
  runId: string;
  seq: number;
  rawBody: string | Uint8Array;
  /** Unix seconds; defaults to now. */
  timestamp?: number;
}

export function signCallback(opts: SignOptions): CallbackHeaders {
  const ts = opts.timestamp ?? Math.floor(Date.now() / 1000);
  return {
    [HEADER_RUN]: opts.runId,
    [HEADER_SEQ]: String(opts.seq),
    [HEADER_TIMESTAMP]: String(ts),
    [HEADER_SIGNATURE]: computeSignature(opts.secret, ts, opts.rawBody),
  };
}

export type VerifyFailure =
  "missing_header" | "bad_timestamp" | "timestamp_skew" | "bad_signature_format" | "signature_mismatch";

export type VerifyResult =
  { ok: true; runId: string; seq: number; timestamp: number } | { ok: false; reason: VerifyFailure };

type HeaderBag = Record<string, string | string[] | undefined> | Headers;

function getHeader(headers: HeaderBag, name: string): string | undefined {
  if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.get(name) ?? undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

export interface VerifyOptions {
  secret: string;
  headers: HeaderBag;
  rawBody: string | Uint8Array;
  /** Unix seconds; defaults to now (injectable for tests). */
  now?: number;
  maxSkewSeconds?: number;
}

export function verifyCallback(opts: VerifyOptions): VerifyResult {
  const runId = getHeader(opts.headers, HEADER_RUN);
  const seqRaw = getHeader(opts.headers, HEADER_SEQ);
  const tsRaw = getHeader(opts.headers, HEADER_TIMESTAMP);
  const sig = getHeader(opts.headers, HEADER_SIGNATURE);
  if (!runId || seqRaw === undefined || !tsRaw || !sig) return { ok: false, reason: "missing_header" };
  if (!/^\d{1,12}$/.test(tsRaw) || !/^\d{1,9}$/.test(seqRaw)) return { ok: false, reason: "bad_timestamp" };
  const ts = Number(tsRaw);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (opts.maxSkewSeconds ?? MAX_SKEW_SECONDS))
    return { ok: false, reason: "timestamp_skew" };
  if (!sig.startsWith(SIG_PREFIX) || !/^[0-9a-f]{64}$/.test(sig.slice(SIG_PREFIX.length))) {
    return { ok: false, reason: "bad_signature_format" };
  }
  const expected = Buffer.from(computeSignature(opts.secret, tsRaw, opts.rawBody));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "signature_mismatch" };
  }
  return { ok: true, runId, seq: Number(seqRaw), timestamp: ts };
}
