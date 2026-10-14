import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Optional in dev; health reports db "unconfigured" without it. */
  DATABASE_URL: z.string().min(1).optional(),
  /**
   * The va_worker login (H1): system work (withSystem) and Better Auth, on a pool separate from DATABASE_URL.
   * Required in production (the server refuses to start without it, see instrumentation.ts).
   */
  DATABASE_URL_SYSTEM: z.string().min(1).optional(),
  /** Signs the tenant context (`app.user_id`) so a SQL-injected set_config cannot impersonate. >= 32 chars; required in production. */
  RLS_CONTEXT_KEY: z.string().min(32).optional(),
  APP_URL: z.url().default("http://localhost:3000"),
  /** Public site origin (sign-in, sign-up, legal pages). Signed-out visitors are redirected here. */
  SITE_URL: z.url().default("https://voidaccess.pro"),
  /** Parent domain for the shared session cookie (".voidaccess.pro"). Unset = host-only cookie. Required in production. */
  COOKIE_DOMAIN: z.string().min(2).optional(),
  /** Cloudflare Turnstile secret; email sign-in code requests are verified with it. Required in production. */
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  /** Build/commit identifier, injected at image build time. */
  APP_VERSION: z.string().min(1).default("0.0.0"),
  COMMIT_SHA: z.string().min(1).default("dev"),
  // ---- run lifecycle (all optional; safe dev defaults, see lib/runs/secrets.ts) ----
  /** Root key for per-run callback secrets and artifact tokens. Required in production. */
  ENGINE_CALLBACK_SECRET: z.string().min(16).optional(),
  /** Cloud Run launcher (R0): where the runner job lives and which bucket holds run artifacts. */
  GCP_PROJECT: z.string().min(1).default("voidaccess-cloud"),
  GCP_REGION: z.string().min(1).default("us-central1"),
  RUNNER_JOB_NAME: z.string().min(1).default("va-runner"),
  RUNS_BUCKET: z.string().min(1).default("voidaccess-cloud-runs"),
  /** Permanent, versioned archive bucket (P4): page snapshots by content hash. */
  ARCHIVE_BUCKET: z.string().min(1).default("voidaccess-cloud-archive"),
  /** The runner job's size, for the per-run compute cost (must match infra/terraform/modules/runner). */
  RUNNER_VCPU: z.coerce.number().positive().default(1),
  RUNNER_MEMORY_GIB: z.coerce.number().positive().default(2),
  /** Which launcher starts runs. Default: mock outside production, cloudrun in production. */
  ENGINE_LAUNCHER: z.enum(["mock", "cloudrun"]).optional(),
  /** Mock engine behaviour: success | failure | cancel | blocked | deadline. */
  MOCK_ENGINE_MODE: z.enum(["success", "failure", "cancel", "blocked", "deadline"]).default("success"),
  /** Mock engine total duration in ms (default 60s). */
  MOCK_ENGINE_DURATION_MS: z.coerce.number().int().positive().default(60_000),
  /** Where the mock engine's bundle upload is stored (default: OS temp dir). */
  MOCK_ARTIFACT_DIR: z.string().min(1).optional(),
  /** Dev shared secret for /api/cron/*. In production use the Cloud Scheduler OIDC identity. */
  CRON_SHARED_SECRET: z.string().min(16).optional(),
  /** Service-account email expected in the Cloud Scheduler OIDC token. */
  CRON_OIDC_EMAIL: z.string().min(1).optional(),
  // ---- billing (P5) ----
  /** Dodo Payments API key. Test-mode key in dev/CI; the live key arrives in the deploy phase. */
  DODO_PAYMENTS_API_KEY: z.string().min(1).optional(),
  /** Which Dodo environment the key belongs to. Defaults to test mode; live is set at deploy. */
  DODO_ENV: z.enum(["test_mode", "live_mode"]).default("test_mode"),
  /** Dodo webhook signing secret (whsec_...). Required to accept webhooks. */
  DODO_WEBHOOK_SECRET: z.string().min(8).optional(),
  /** "fake" swaps in an in-memory provider (tests, e2e). Never used in production. */
  BILLING_PROVIDER: z.enum(["dodo", "fake"]).optional(),
  /** Marketing-site origin allowed to read GET /api/founding/seats. */
  SITE_ORIGIN: z.url().default("https://voidaccess.pro"),
});

export type Env = z.infer<typeof envSchema>;

/** Parse an env-like object; throws a readable error on invalid values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings as unset so blank vars in .env files don't fail validation.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Lazily validated process env; nothing is read at import/build time. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
