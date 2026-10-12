/**
 * Validates the `next` query parameter of the auth pages and returns the absolute URL to send the user to after
 * sign-in. Only the configured app origin is accepted (exact origin match, no credentials in the URL), so this can
 * never become an open redirect. Anything else falls back to `${appUrl}/welcome`.
 */
export function safeNext(next: string | null | undefined, appUrl: string): string {
  const origin = new URL(appUrl).origin;
  const fallback = `${origin}/welcome`;
  // Browsers treat "\" like "/" and strip tabs/newlines, so reject them outright instead of reasoning about parsers.
  if (!next || next.length > 2048 || /[\\\u0000- \u007f]/.test(next)) return fallback;
  if (next.startsWith("//")) return fallback;
  try {
    const url = new URL(next.startsWith("/") ? `${origin}${next}` : next);
    if (url.origin !== origin || url.username || url.password) return fallback;
    return url.href;
  } catch {
    return fallback;
  }
}
