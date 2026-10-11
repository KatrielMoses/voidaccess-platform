import { defineConfig } from "@playwright/test";

const PORT = 3101;
const DB = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/voidaccess_site_test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm exec next build && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/founding/seats`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: DB,
      SITE_URL: `http://localhost:${PORT}`,
      EMAIL_TRANSPORT: "log",
      MAIL_LOG_FILE: "/tmp/va-site-e2e-mail.log",
      // Cloudflare's documented always-pass Turnstile test keys
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      IP_HASH_SALT: "e2e-salt",
      PLAUSIBLE_DISABLED: "1",
    },
  },
});
