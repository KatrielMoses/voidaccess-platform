// Results-lane end-to-end run (dev server on :3200). Users sign in with an emailed code like real users.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { E2E_DB, appUrl } from "./e2e/results-global-setup";
import { DEV_CONTEXT_KEY } from "@voidaccess/db/client";
import { localSystemUrl } from "@voidaccess/db/local";

void E2E_DB;
export const RESULTS_EMAIL_LOG = join(tmpdir(), "va-p3-e2e-emails.jsonl");
export default defineConfig({
  outputDir: "test-results/results", // per suite, so suites can run side by side
  testDir: "e2e",
  testMatch: /results(-workspace)?\.spec\.ts/,
  globalSetup: "./e2e/results-global-setup.ts",
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:3200",
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
        "--enable-webgl",
      ],
    },
  },
  webServer: {
    command: "pnpm exec next dev -p 3200",
    url: "http://localhost:3200/",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_DIST_DIR: ".next-e2e-results",
      DATABASE_URL: appUrl(),
      DATABASE_URL_SYSTEM: localSystemUrl(appUrl()),
      RLS_CONTEXT_KEY: DEV_CONTEXT_KEY,
      VA_FINGERPRINT_KEY: "e2e-fp",
      VA_LOCAL_KEK: Buffer.alloc(32, 5).toString("base64"),
      APP_URL: "http://localhost:3200",
      BETTER_AUTH_SECRET: "e2e-better-auth-secret-0123456789-abcdef",
      ENGINE_CALLBACK_SECRET: "e2e-engine-callback-secret-0123456789",
      CRON_SHARED_SECRET: "e2e-cron-shared-secret-0123456789",
      ENGINE_LAUNCHER: "mock",
      EMAIL_LOG_FILE: RESULTS_EMAIL_LOG,
    },
  },
});
