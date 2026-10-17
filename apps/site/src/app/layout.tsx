import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { preload } from "react-dom";
import { Attribution } from "@/components/attribution";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { JsonLd } from "@/components/json-ld";
import { MinimalFooter, MinimalHeader } from "@/components/minimal-chrome";
import { MOTION_BOOT } from "@/lib/motion-boot";
import { getStars } from "@/lib/github";
import { organizationLd } from "@/lib/jsonld";
import { SITE_URL } from "@/lib/site";
import { IS_MINIMAL } from "@/lib/site-mode";
import { siteContent } from "@content/site";
import "./globals.css";

// Fonts are self-hosted from public/fonts (@font-face in @voidaccess/ui/tokens.css). Preload the three the pages use
// first, as the home page does.
const PRELOAD_FONTS = ["/fonts/GeneralSans-500.woff2", "/fonts/GeneralSans-400.woff2", "/fonts/GeistMono-400.woff2", "/fonts/Sora-500.woff2"];

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "VoidAccess", template: "%s" },
  description: siteContent.defaultDescription,
  applicationName: "VoidAccess",
  authors: [{ name: "Katriel Moses" }],
  icons: {
    icon: [
      { url: "/assets/favicon.ico", sizes: "any" },
      { url: "/assets/favicon-32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: "/assets/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = { themeColor: "#0F0F12", colorScheme: "dark" };

// Minimal mode serves no /pl proxy, so analytics stay off there.
const PLAUSIBLE_ON = !IS_MINIMAL && process.env.NODE_ENV === "production" && process.env.PLAUSIBLE_DISABLED !== "1";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const stars = IS_MINIMAL ? null : ((await getStars()) ?? siteContent.githubStarsFallback);
  for (const href of PRELOAD_FONTS) preload(href, { as: "font", type: "font/woff2", crossOrigin: "" });
  return (
    // suppressHydrationWarning: MOTION_BOOT adds a class to <html> before React hydrates
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Before first paint: decides whether entrances may play (lib/motion.ts). It never hides content for more than
            4s on its own, and without JavaScript it never runs, so everything is visible. */}
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT }} />
      </head>
      <body className={IS_MINIMAL ? "flex flex-col" : undefined}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-sm focus:bg-paper focus:px-4 focus:py-2 focus:text-ink">
          Skip to content
        </a>
        {IS_MINIMAL ? <MinimalHeader /> : <Header stars={stars} />}
        <main id="main" className={IS_MINIMAL ? "va-main flex-1" : undefined}>
          {children}
        </main>
        {IS_MINIMAL ? <MinimalFooter /> : <Footer />}
        <Attribution />
        <JsonLd data={organizationLd()} />
        {PLAUSIBLE_ON && <Script src="/pl/script.js" data-domain="voidaccess.pro" data-api="/pl/event" strategy="afterInteractive" />}
      </body>
    </html>
  );
}
