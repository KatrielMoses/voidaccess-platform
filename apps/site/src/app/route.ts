import page from "../home/index.html";

/**
 * The home page is the static site from website-mockups/site (design.md), served byte-for-byte. The HTML's exact bytes
 * are inlined into the bundle at build time (turbopack rule `*.html` -> type "bytes", next.config.ts), so it works the
 * same under `next start` and on Cloudflare Workers, where there is no filesystem. Its CSS, JS, vendor files, fonts and assets
 * live in public/ at the absolute paths the HTML uses. Do not edit src/home/index.html or those files here: change
 * them in website-mockups/site and copy them over.
 */
export function GET() {
  return new Response(page, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" },
  });
}
