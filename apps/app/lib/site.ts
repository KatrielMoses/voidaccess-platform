/** Marketing site base URL (AUP, terms, privacy live there). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://voidaccess.pro").replace(/\/$/, "");
export const AUP_URL = `${SITE_URL}/acceptable-use`;
