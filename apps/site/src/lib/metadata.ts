import type { Metadata } from "next";
import { resolve } from "./facts";
import { abs } from "./site";
import { IS_MINIMAL } from "./site-mode";
import type { PageMeta } from "@content/types";

/** Unique title/description per page, canonical URL, and OG/Twitter images from the /og route. */
export function pageMetadata(meta: PageMeta, path: string): Metadata {
  const title = resolve(meta.title);
  const description = resolve(meta.description);
  const image = abs(`/og?title=${encodeURIComponent(title)}`);
  // Minimal mode doesn't serve /og, so it advertises no social image.
  if (IS_MINIMAL) return { title: { absolute: title }, description, alternates: { canonical: abs(path) } };
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: abs(path) },
    openGraph: { type: "website", url: abs(path), title, description, siteName: "VoidAccess", images: [{ url: image, width: 1200, height: 630, alt: title }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
