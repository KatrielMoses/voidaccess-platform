import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Same derivation as test/urls.ts (inlined: a native config loader cannot import extensionless paths).
const admin = new URL(process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/postgres");
const testDb = `${process.env.VA_TEST_DB ?? "voidaccess_test"}_app`;
const appUrl = (() => {
  const c = new URL(admin.toString());
  c.pathname = `/${testDb}`;
  c.username = "va_app";
  c.password = process.env.VA_APP_LOCAL_PASSWORD ?? "va_app_local";
  return c.toString();
})();

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["env.test.ts", "test/**/*.test.ts", "test/**/*.test.tsx", "lib/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    setupFiles: ["test/setup.ts"],
    fileParallelism: false, // tests share one database
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      // the app connects as va_app (RLS applies), exactly like production
      DATABASE_URL: appUrl,
      APP_URL: "http://localhost:3000",
      ENGINE_CALLBACK_SECRET: "test-engine-callback-secret-0123456789",
      ENGINE_LAUNCHER: "mock",
      CRON_SHARED_SECRET: "test-cron-shared-secret-0123456789",
      MOCK_ARTIFACT_DIR: join(tmpdir(), "va-p2-test-artifacts"),
      VA_FINGERPRINT_KEY: "test-fingerprint-key",
      VA_LOCAL_KEK: Buffer.alloc(32, 7).toString("base64"),
    },
  },
});
