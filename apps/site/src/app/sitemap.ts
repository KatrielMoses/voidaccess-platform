import type { MetadataRoute } from "next";
import { abs } from "@/lib/site";

export const dynamic = "force-static";

const paths = ["/", "/features", "/pricing", "/trust", "/open-source", "/waitlist", "/terms", "/privacy", "/acceptable-use"];

export default function sitemap(): MetadataRoute.Sitemap {
  return paths.map((p) => ({ url: abs(p), changeFrequency: p === "/" ? "weekly" : "monthly", priority: p === "/" ? 1 : p === "/pricing" ? 0.9 : 0.6 }));
}
