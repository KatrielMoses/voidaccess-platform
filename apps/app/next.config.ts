import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(here, "../..");

const nextConfig: NextConfig = {
  // Each Playwright suite runs its own dev server with its own build dir, so suites never share a stale cache
  // or Next's per-directory dev lock. Production builds use the default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  transpilePackages: ["@voidaccess/ui", "@voidaccess/db", "@voidaccess/config"],
  poweredByHeader: false,
};

export default nextConfig;
