import page from "../home/index.html";
import { APP_URL } from "@/lib/auth/config";

/**
 * The home page: the design site (website-mockups/site, design.md) with VoidAccess Cloud's content. The HTML's bytes
 * are inlined into the bundle at build time (turbopack rule `*.html` -> type "bytes", next.config.ts), so it works the
 * same under `next start` and on Cloudflare Workers, where there is no filesystem. Its CSS, JS, vendor files, fonts and
 * assets live in public/ at the absolute paths the HTML uses. The app's origin is filled in here (the hunt field opens
 * a new investigation there), so the same HTML works locally and in production.
 */
const html = new TextDecoder().decode(page).replace("__VA_APP_URL__", APP_URL);

export function GET() {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" },
  });
}
