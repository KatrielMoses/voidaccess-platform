// Cross-domain auth settings, kept pure so tests can pin them. The app (APP_URL) owns Better Auth; the site
// (SITE_URL) hosts the sign-in pages and calls it with credentials. Nothing else is ever trusted.
export const DEV_APP_ORIGINS = ["http://app.va.localhost:3600", "http://localhost:3600"] as const;
export const DEV_SITE_ORIGINS = ["http://va.localhost:3700", "http://localhost:3700"] as const;

const origin = (u: string) => new URL(u).origin;

/** Exactly the two production origins; the local dev pairs are added outside production only. */
export function trustedOrigins(appUrl: string, siteUrl: string, isProd: boolean): string[] {
  const list = [origin(appUrl), origin(siteUrl)];
  if (!isProd) list.push(...DEV_APP_ORIGINS, ...DEV_SITE_ORIGINS);
  return [...new Set(list)];
}

/** Origins allowed to call /api/auth/* cross-origin (with credentials): the site only. */
export function corsOrigins(siteUrl: string, isProd: boolean): string[] {
  return [origin(siteUrl), ...(isProd ? [] : DEV_SITE_ORIGINS)];
}

/** Hostnames the shared cookie domain must cover (a leading dot is ignored). */
export function cookieDomainCovers(domain: string, urls: string[]): boolean {
  const d = domain.replace(/^\./, "");
  return urls.every((u) => {
    const h = new URL(u).hostname;
    return h === d || h.endsWith(`.${d}`);
  });
}
