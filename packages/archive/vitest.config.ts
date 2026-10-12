import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      VA_FINGERPRINT_KEY: "test-fingerprint-key",
      VA_LOCAL_KEK: Buffer.alloc(32, 7).toString("base64"),
    },
  },
});
