// Billing end-to-end run (dev server on :3400): fake Creem and crypto providers, signed webhooks and IPNs built exactly
// as Creem and NOWPayments sign them.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { IPN_SECRET, WEBHOOK_SECRET, appUrl } from "./e2e/billing-global-setup";
import { DEV_CONTEXT_KEY } from "@voidaccess/db/client";
import { localSystemUrl } from "@voidaccess/db/local";

export const BILLING_EMAIL_LOG = join(tmpdir(), "va-p5-e2e-emails.jsonl");
const PORT = 3400;

export default defineConfig({
  outputDir: "test-results/billing", // per suite, so suites can run side by side
  testDir: "e2e",
  testMatch: /billing(-screenshots)?\.spec\.ts/,
  globalSetup: "./e2e/billing-global-setup.ts",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NEXT_DIST_DIR: ".next-e2e-billing",
      DATABASE_URL: appUrl(),
      DATABASE_URL_SYSTEM: localSystemUrl(appUrl()),
      RLS_CONTEXT_KEY: DEV_CONTEXT_KEY,
      APP_URL: `http://localhost:${PORT}`,
      VA_FINGERPRINT_KEY: "e2e-fp",
      VA_LOCAL_KEK: Buffer.alloc(32, 5).toString("base64"),
      BETTER_AUTH_SECRET: "e2e-better-auth-secret-0123456789-abcdef",
      ENGINE_CALLBACK_SECRET: "e2e-engine-callback-secret-0123456789",
      CRON_SHARED_SECRET: "e2e-cron-shared-secret-0123456789",
      ENGINE_LAUNCHER: "mock",
      MOCK_ENGINE_DURATION_MS: "8000",
      MOCK_ARTIFACT_DIR: join(tmpdir(), "va-p5-e2e-artifacts"),
      EMAIL_LOG_FILE: BILLING_EMAIL_LOG,
      BILLING_PROVIDER: "fake",
      CREEM_ENV: "test_mode",
      CREEM_WEBHOOK_SECRET: WEBHOOK_SECRET,
      CRYPTO_PAYMENTS: "on",
      CRYPTO_PROVIDER: "fake",
      NOWPAYMENTS_IPN_SECRET: IPN_SECRET,
    },
    stdout: "ignore",
    stderr: "pipe",
  },
});
