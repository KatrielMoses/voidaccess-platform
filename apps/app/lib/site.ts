/** Marketing site base URL (AUP, terms, privacy live there). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://voidaccess.pro").replace(/\/$/, "");
/** Where signed-out visitors sign in (the site owns the auth pages). */
export const SIGN_IN_URL = `${SITE_URL}/sign-in`;
export const AUP_URL = `${SITE_URL}/acceptable-use`;
/** The public engine repository ("Star us on GitHub" prompt). */
export const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/KatrielMoses/VoidAccess";
/** Customer support address: shown in Billing and Settings, and on the site and receipts. */
export const SUPPORT_EMAIL = "support@voidaccess.pro";
