/**
 * Google access tokens with plain `fetch` (no google-auth-library: it does not resolve under pnpm from this package).
 *
 * Order: GCP_ACCESS_TOKEN (dev and tests) -> the metadata server (Cloud Run, the production path) -> Application
 * Default Credentials of type `authorized_user` (a developer's `gcloud auth application-default login`).
 * Service-account key files are deliberately not supported: nothing in this system should hold one.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REFRESH_SKEW_MS = 60_000;
const METADATA_TIMEOUT_MS = 2_000;

export class GcpAuthError extends Error {}

export type TokenProvider = () => Promise<string>;

interface CachedToken {
  token: string;
  expiresAt: number;
}

export function createTokenProvider(
  opts: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {},
): TokenProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const env = opts.env ?? process.env;
  let cached: CachedToken | null = null;

  async function fromMetadata(): Promise<CachedToken> {
    const res = await doFetch(METADATA_TOKEN_URL, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (!res.ok) throw new GcpAuthError(`metadata server returned ${res.status}`);
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new GcpAuthError("metadata server returned no token");
    return { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 300) * 1000 - REFRESH_SKEW_MS };
  }

  async function fromAdc(): Promise<CachedToken> {
    const path =
      env.GOOGLE_APPLICATION_CREDENTIALS ??
      join(homedir(), ".config", "gcloud", "application_default_credentials.json");
    let creds: { type?: string; client_id?: string; client_secret?: string; refresh_token?: string };
    try {
      creds = JSON.parse(await readFile(/*turbopackIgnore: true*/ path, "utf8")); // dev-only ADC file, chosen at runtime
    } catch {
      throw new GcpAuthError(
        "no Google credentials: not on Cloud Run and no application default credentials",
      );
    }
    if (creds.type !== "authorized_user" || !creds.refresh_token)
      throw new GcpAuthError(
        "unsupported credentials type (only authorized_user is supported outside Cloud Run)",
      );
    const res = await doFetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: creds.client_id ?? "",
        client_secret: creds.client_secret ?? "",
        refresh_token: creds.refresh_token,
      }),
    });
    if (!res.ok) throw new GcpAuthError(`token refresh failed (${res.status})`);
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new GcpAuthError("token refresh returned no token");
    return { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 300) * 1000 - REFRESH_SKEW_MS };
  }

  return async () => {
    if (env.GCP_ACCESS_TOKEN) return env.GCP_ACCESS_TOKEN;
    // A unit test must never reach the real Google APIs through a developer's own credentials.
    if (env.NODE_ENV === "test") throw new GcpAuthError("Google credentials are disabled under test");
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    // On Cloud Run the metadata server is the only source; elsewhere try it first (it fails fast), then ADC.
    try {
      cached = await fromMetadata();
    } catch (e) {
      if (env.K_SERVICE || env.CLOUD_RUN_JOB) throw e;
      cached = await fromAdc();
    }
    return cached.token;
  };
}

let shared: TokenProvider | undefined;
export const defaultTokenProvider: TokenProvider = () => (shared ??= createTokenProvider())();
