export const SITE_URL = (process.env.SITE_URL ?? "https://voidaccess.pro").replace(/\/$/, "");
export const SITE_NAME = "VoidAccess";
export const GITHUB_REPO = "KatrielMoses/VoidAccess";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
export const SPONSORS_URL = "https://github.com/sponsors/KatrielMoses";
export const MAILACCESS_URL = "https://github.com/KatrielMoses/MailAccess";

export function abs(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
