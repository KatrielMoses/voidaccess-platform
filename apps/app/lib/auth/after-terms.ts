/**
 * Where to go once the policy is accepted: the page the user was heading to (e.g. a new investigation with the query
 * from the home page), as long as it is a path on this app. Anything else (another origin, protocol-relative, the
 * terms page itself) falls back to /welcome, so this can never become an open redirect.
 */
export function afterTermsPath(value: unknown): string {
  if (typeof value !== "string" || !/^\/(?![/\\])/.test(value) || value.length > 2000) return "/welcome";
  if (value === "/" || value.startsWith("/accept-terms")) return "/welcome";
  return value;
}
