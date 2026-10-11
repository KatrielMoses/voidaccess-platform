/** Visitor IP as seen by Cloudflare, falling back to the first forwarded hop. */
export function clientIp(headers: Headers): string | null {
  return headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}
