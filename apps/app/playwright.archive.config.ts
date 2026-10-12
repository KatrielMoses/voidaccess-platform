// Archive end-to-end run (dev server on :3500): two real users, the mock engine, the archive worker over the mock artifact store.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { appUrl } from "./e2e/archive-global-setup";

export const ARCHIVE_EMAIL_LOG = join(tmpdir(), "va-p4-e2e-emails.jsonl");
export const ARCHIVE_STORE = join(tmpdir(), "va-p4-e2e-archive-objects");
export const ARTIFACTS = join(tmpdir(), "va-p4-e2e-artifacts");
export const CRON_SECRET = "e2e-cron-shared-secret-0123456789";
const PORT = 3500;

export default defineConfig({
  outputDir: "test-results/archive", // per suite, so suites can run side by side
  testDir: "e2e",
  testMatch: /archive(-screenshots)?\.spec\.ts/,
  globalSetup: "./e2e/archive-global-setup.ts",
  timeout: 300_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
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
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NEXT_DIST_DIR: ".next-e2e-archive",
      DATABASE_URL: appUrl(),
      APP_URL: `http://localhost:${PORT}`,
      VA_FINGERPRINT_KEY: "e2e-fp",
      VA_LOCAL_KEK: Buffer.alloc(32, 5).toString("base64"),
      BETTER_AUTH_SECRET: "e2e-better-auth-secret-0123456789-abcdef",
      ENGINE_CALLBACK_SECRET: "e2e-engine-callback-secret-0123456789",
      CRON_SHARED_SECRET: CRON_SECRET,
      ENGINE_LAUNCHER: "mock",
      MOCK_ENGINE_DURATION_MS: "8000",
      MOCK_ARTIFACT_DIR: ARTIFACTS,
      ARCHIVE_STORE_DIR: ARCHIVE_STORE,
      EMAIL_LOG_FILE: ARCHIVE_EMAIL_LOG,
    },
    stdout: "ignore",
    stderr: "pipe",
  },
});
