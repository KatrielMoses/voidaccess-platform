/**
 * Derived secrets. Nothing secret is stored per run: both the callback key and the mock artifact token
 * are HMACs of the run id under ENGINE_CALLBACK_SECRET.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "../../env";

const DEV_ROOT = "dev-only-engine-callback-secret-do-not-use-in-prod";

function root(): string {
  const s = getEnv().ENGINE_CALLBACK_SECRET;
  if (s) return s;
  if (getEnv().NODE_ENV === "production") throw new Error("ENGINE_CALLBACK_SECRET is required in production");
  return DEV_ROOT;
}

const hmacHex = (label: string, runId: string) =>
  createHmac("sha256", root()).update(`${label}:${runId}`).digest("hex");

/** Per-run HMAC key the engine signs callbacks with (delivered only inside the single-use RunSpec). */
export const deriveCallbackSecret = (runId: string) => hmacHex("callback", runId);

/** Token protecting the mock engine's bundle PUT URL. */
export const deriveArtifactToken = (runId: string) => hmacHex("artifact:bundle", runId);

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Random single-use spec token (256 bits). Only its sha256 is stored. */
export const mintSpecToken = () => randomBytes(32).toString("base64url");
export const hashSpecToken = (t: string) => createHash("sha256").update(t).digest("hex");
