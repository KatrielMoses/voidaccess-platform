import type { MetadataRoute } from "next";
import { abs } from "@/lib/site";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/pl/", "/waitlist/confirmed", "/waitlist/check-email"] }],
    sitemap: abs("/sitemap.xml"),
    host: abs("/"),
  };
}
