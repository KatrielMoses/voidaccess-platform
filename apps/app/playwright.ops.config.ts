// Ops end-to-end run (dev server on :3800): the console owner (secret path + authenticator), an ordinary user, the mock
// engine, the admin console.
//   pnpm --filter @voidaccess/app test:e2e:ops
//   SCREENSHOTS=1 pnpm --filter @voidaccess/app test:e2e:ops    (also writes docs/screenshots/ops/*.png)
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { appUrl } from "./e2e/ops-global-setup";
import { DEV_CONTEXT_KEY } from "@voidaccess/db/client";
import { localSystemUrl } from "@voidaccess/db/local";

export const OPS_EMAIL_LOG = join(tmpdir(), "va-p6-e2e-emails.jsonl");
export const OPS_ARCHIVE_STORE = join(tmpdir(), "va-p6-e2e-archive-objects");
export const OPS_CRON_SECRET = "e2e-cron-shared-secret-0123456789";
/** A fixed TEST slug for the console (not a real one; the production slug is only in Secret Manager). */
export const OPS_ADMIN_PATH = "ops-e2e-console-path-not-a-secret";
export const OPS_ADMIN_BASE = `/${OPS_ADMIN_PATH}`;
/** The console owner in this run (the database is fresh each run). */
export const OPS_ADMIN_EMAIL = "ops-owner@example.test";
const PORT = 3800;

export default defineConfig({
  outputDir: "test-results/ops", // per suite, so suites can run side by side
  testDir: "e2e",
  testMatch: /ops\.spec\.ts/,
  globalSetup: "./e2e/ops-global-setup.ts",
  timeout: 300_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 1, // the serial group reruns as a whole; dev-server recompiles occasionally abort a navigation
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    // not /api/health: the database is created by globalSetup, which runs after the web server is up
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NEXT_DIST_DIR: ".next-e2e-ops",
      DATABASE_URL: appUrl(),
      DATABASE_URL_SYSTEM: localSystemUrl(appUrl()),
      RLS_CONTEXT_KEY: DEV_CONTEXT_KEY,
      APP_URL: `http://localhost:${PORT}`,
      VA_FINGERPRINT_KEY: "e2e-fp",
      VA_LOCAL_KEK: Buffer.alloc(32, 5).toString("base64"),
      BETTER_AUTH_SECRET: "e2e-better-auth-secret-0123456789-abcdef",
      ENGINE_CALLBACK_SECRET: "e2e-engine-callback-secret-0123456789",
      CRON_SHARED_SECRET: OPS_CRON_SECRET,
      ENGINE_LAUNCHER: "mock",
      MOCK_ENGINE_DURATION_MS: "6000",
      MOCK_ARTIFACT_DIR: join(tmpdir(), "va-p6-e2e-artifacts"),
      ARCHIVE_STORE_DIR: OPS_ARCHIVE_STORE,
      EMAIL_LOG_FILE: OPS_EMAIL_LOG,
      ADMIN_PATH: OPS_ADMIN_PATH,
      ADMIN_EMAIL: OPS_ADMIN_EMAIL,
    },
    stdout: "ignore",
    stderr: "pipe",
  },
});
