import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx", "test/**/*.test.ts", "test/**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
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
