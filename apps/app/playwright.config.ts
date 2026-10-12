import { defineConfig } from "@playwright/test";
import { E2E_DB, appUrl } from "./e2e/global-setup";

void E2E_DB;
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./e2e/global-setup.ts",
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
    command: "pnpm dev",
    url: "http://localhost:3200/",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: appUrl(),
      VA_FINGERPRINT_KEY: "e2e-fp",
      VA_LOCAL_KEK: Buffer.alloc(32, 5).toString("base64"),
      DEV_AS_USER: "",
    },
  },
});
