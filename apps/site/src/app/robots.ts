import type { MetadataRoute } from "next";
import { abs } from "@/lib/site";
import { AUTH_PATHS, IS_MINIMAL } from "@/lib/site-mode";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  if (IS_MINIMAL) return { rules: [{ userAgent: "*", allow: "/", disallow: [...AUTH_PATHS] }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/pl/", "/waitlist/confirmed", "/waitlist/check-email", ...AUTH_PATHS] }],
    sitemap: abs("/sitemap.xml"),
    host: abs("/"),
  };
}
