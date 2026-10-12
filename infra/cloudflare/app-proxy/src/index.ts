// Transparent reverse proxy: app.voidaccess.pro -> the Cloud Run service. No logic of its own. Method, body, cookies
// and Set-Cookie pass through untouched (the app owns auth); streaming (SSE) responses stream through.
interface Env {
  UPSTREAM: string;
  PUBLIC_HOST: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const upstream = new URL(env.UPSTREAM);
    upstream.pathname = url.pathname;
    upstream.search = url.search;

    const headers = new Headers(req.headers);
    // The real client IP, never a client-supplied one: the app keys its rate limits on x-forwarded-for.
    const ip = req.headers.get("cf-connecting-ip");
    if (ip) headers.set("x-forwarded-for", ip);
    else headers.delete("x-forwarded-for");
    headers.set("x-forwarded-host", env.PUBLIC_HOST);
    headers.set("x-forwarded-proto", "https");

    const res = await fetch(new Request(upstream, { method: req.method, headers, body: req.body, redirect: "manual" }));
    // Redirects that point at the upstream host would leak it; rewrite to the public host.
    const loc = res.headers.get("location");
    if (loc?.startsWith(env.UPSTREAM)) {
      const out = new Response(res.body, res);
      out.headers.set("location", loc.replace(env.UPSTREAM, `https://${env.PUBLIC_HOST}`));
      return out;
    }
    return res;
  },
} satisfies ExportedHandler<Env>;
