/** Where the app (Better Auth server) lives. Inlined at build time; override locally with NEXT_PUBLIC_APP_URL. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.voidaccess.pro").replace(/\/$/, "");
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
export const CAPTCHA_HEADER = "x-captcha-response";

export type AuthProvider = "google" | "microsoft" | "github";
const KNOWN: readonly AuthProvider[] = ["google", "microsoft", "github"];
/** Social sign-in buttons to show, in this order. Only list providers configured on the app (NEXT_PUBLIC_AUTH_PROVIDERS). */
export const AUTH_PROVIDERS: AuthProvider[] = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? "github")
  .split(",")
  .map((p) => p.trim())
  .filter((p): p is AuthProvider => (KNOWN as readonly string[]).includes(p))
  .sort((a, b) => KNOWN.indexOf(a) - KNOWN.indexOf(b));
