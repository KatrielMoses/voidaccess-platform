import { defineConfig } from "@playwright/test";

// Production proof (D1-5). No web server: it drives https://voidaccess.pro and https://app.voidaccess.pro.
//   DATABASE_URL=<va_app url> pnpm exec playwright test -c playwright.prod.config.ts
export default defineConfig({
  testDir: "./e2e-prod",
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { trace: "off", screenshot: "off" },
});
