/** Where the app (Better Auth server) lives. Inlined at build time; override locally with NEXT_PUBLIC_APP_URL. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.voidaccess.pro").replace(/\/$/, "");
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
export const CAPTCHA_HEADER = "x-captcha-response";
