import { defineConfig } from "@playwright/test";

// SITE_MODE=minimal e2e: no database, no Resend, no app. Run with `pnpm test:e2e:minimal`.
const PORT = 3701;

export default defineConfig({
  testDir: "tests/e2e-minimal",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm exec next build && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/robots.txt`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      SITE_MODE: "minimal",
      SITE_URL: `http://localhost:${PORT}`,
      NEXT_PUBLIC_APP_URL: "http://app.va.localhost:3600",
      // Cloudflare's documented always-pass Turnstile test site key
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    },
  },
});
