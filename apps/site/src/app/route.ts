import page from "../home/index.html";
import { fill, staticTokens, statsTokens } from "../home/render";
import { APP_URL } from "@/lib/auth/config";
import { getStats } from "@/lib/stats";

/**
 * The home page: the design site (website-mockups/site, design.md) with VoidAccess Cloud's content. The HTML's bytes
 * are inlined into the bundle at build time (turbopack rule `*.html` -> type "bytes", next.config.ts), so it works the
 * same under `next start` and on Cloudflare Workers, where there is no filesystem. Its CSS, JS, vendor files, fonts and
 * assets live in public/ at the absolute paths the HTML uses. The app's origin and the prices are filled in once
 * (src/home/render.ts); the GitHub stars and PyPI downloads on each request from lib/stats.ts, which caches them for
 * an hour and falls back to last-known values, so this stays fast and never shows an empty number.
 */
const html = fill(new TextDecoder().decode(page), staticTokens(APP_URL), { strict: false });

// Rendered per request, never prerendered: the numbers are cached in lib/stats.ts (and its fetches keep their own
// hour-long revalidate), so a build never freezes them.
export const revalidate = 0;

export async function GET() {
  const body = fill(html, statsTokens(await getStats()));
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" },
  });
}
