/** Marketing site base URL (AUP, terms, privacy live there). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://voidaccess.pro").replace(/\/$/, "");
/** Where signed-out visitors sign in (the site owns the auth pages). */
export const SIGN_IN_URL = `${SITE_URL}/sign-in`;
export const AUP_URL = `${SITE_URL}/acceptable-use`;
