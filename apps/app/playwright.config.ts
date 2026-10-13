import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { DEV_CONTEXT_KEY } from "@voidaccess/db/client";
import { localSystemUrl } from "@voidaccess/db/local";

// The end-to-end run uses the mock engine on a local database. Port 3000 unless E2E_PORT says otherwise.
//   pnpm --filter @voidaccess/app test:e2e          (next dev)
//   E2E_PROD=1 pnpm --filter @voidaccess/app test:e2e   (production build + next start)
const PORT = Number(process.env.E2E_PORT ?? 3000); // lanes running side by side each pick their own
// A dedicated database, dropped and recreated by e2e/prepare-db.ts on every run, so no lane pollutes it.
const OWNER_URL = process.env.E2E_MIGRATE_URL ?? "postgres://localhost/voidaccess_e2e_app";
const APP_DB_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://va_app:va_app_local@localhost/voidaccess_e2e_app";
export const EMAIL_LOG = join(tmpdir(), "va-p2-e2e-emails.jsonl");

export const e2eEnv = {
  DATABASE_URL: APP_DB_URL,
  DATABASE_URL_SYSTEM: localSystemUrl(APP_DB_URL),
  RLS_CONTEXT_KEY: DEV_CONTEXT_KEY, // required by the production build (E2E_PROD=1)
  MIGRATE_DATABASE_URL: OWNER_URL,
  APP_URL: `http://localhost:${PORT}`,
  ENGINE_LAUNCHER: "mock",
  MOCK_ENGINE_MODE: "success",
  // long enough to cancel mid-run, short enough for a quick test (default is 60 s)
  MOCK_ENGINE_DURATION_MS: process.env.E2E_MOCK_MS ?? "12000",
  MOCK_ARTIFACT_DIR: join(tmpdir(), "va-p2-e2e-artifacts"),
  EMAIL_LOG_FILE: EMAIL_LOG,
  ENGINE_CALLBACK_SECRET: "e2e-engine-callback-secret-0123456789",
  BETTER_AUTH_SECRET: "e2e-better-auth-secret-0123456789-abcdef",
  CRON_SHARED_SECRET: "e2e-cron-shared-secret-0123456789",
  // ingest (P3) masks and fingerprints sensitive values; local key instead of Cloud KMS
  VA_FINGERPRINT_KEY: "e2e-fingerprint-key",
  VA_LOCAL_KEK: Buffer.alloc(32, 5).toString("base64"),
};

export default defineConfig({
  outputDir: "test-results/app", // per suite, so suites can run side by side
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  testIgnore: /results\.spec\.ts/, // runs via playwright.results.config.ts
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: process.env.E2E_PROD
      ? `pnpm exec tsx e2e/prepare-db.ts && pnpm exec next build && pnpm exec next start -p ${PORT}`
      : `pnpm exec tsx e2e/prepare-db.ts && pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: { ...e2eEnv, NODE_ENV: process.env.E2E_PROD ? "production" : "development" } as Record<
      string,
      string
    >,
    stdout: "ignore",
    stderr: "pipe",
  },
});
