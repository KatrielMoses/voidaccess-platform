import type { NextConfig } from "next";
import path from "node:path";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@voidaccess/config", "@voidaccess/db", "@voidaccess/ui"],
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  turbopack: {
    root: path.join(import.meta.dirname, "../.."),
    // The static home page (src/home/index.html) is imported by app/route.ts as its exact bytes (a Uint8Array).
    // ("raw" does not inline the contents, and there is no "text" type.)
    rules: { "*.html": { type: "bytes" } },
  },
  images: { unoptimized: true },
  // SITE_MODE=minimal is read at build time and inlined (see src/lib/site-mode.ts).
  env: { NEXT_PUBLIC_SITE_MODE: process.env.SITE_MODE ?? "" },
  async rewrites() {
    if (process.env.SITE_MODE === "minimal") return [];
    // Plausible script served first-party so ad blockers and third-party cookie rules don't apply.
    // The event endpoint is a route handler (app/pl/event) so we can forward the visitor IP.
    return [{ source: "/pl/script.js", destination: "https://plausible.io/js/script.js" }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
