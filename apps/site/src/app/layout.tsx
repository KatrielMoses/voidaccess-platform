import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Script from "next/script";
import { Attribution } from "@/components/attribution";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { JsonLd } from "@/components/json-ld";
import { MinimalFooter, MinimalHeader } from "@/components/minimal-chrome";
import { getStars } from "@/lib/github";
import { organizationLd } from "@/lib/jsonld";
import { SITE_URL } from "@/lib/site";
import { IS_MINIMAL } from "@/lib/site-mode";
import { siteContent } from "@content/site";
import "./globals.css";

// Self-hosted by next/font with size-adjusted fallbacks, so swapping fonts doesn't shift layout.
const display = Space_Grotesk({ subsets: ["latin"], variable: "--nf-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--nf-body", display: "optional" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--nf-mono", display: "optional", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "VoidAccess", template: "%s" },
  description: siteContent.defaultDescription,
  applicationName: "VoidAccess",
  authors: [{ name: "Katriel Moses" }],
  icons: { icon: "/logo-96.png", apple: "/logo-96.png" },
};

export const viewport: Viewport = { themeColor: "#080b11", colorScheme: "dark" };

// Minimal mode serves no /pl proxy, so analytics stay off there.
const PLAUSIBLE_ON = !IS_MINIMAL && process.env.NODE_ENV === "production" && process.env.PLAUSIBLE_DISABLED !== "1";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const stars = IS_MINIMAL ? null : ((await getStars()) ?? siteContent.githubStarsFallback);
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-fg-inverse">
          Skip to content
        </a>
        {IS_MINIMAL ? <MinimalHeader /> : <Header stars={stars} />}
        <main id="main">{children}</main>
        {IS_MINIMAL ? <MinimalFooter /> : <Footer />}
        <Attribution />
        <JsonLd data={organizationLd()} />
        {PLAUSIBLE_ON && <Script src="/pl/script.js" data-domain="voidaccess.pro" data-api="/pl/event" strategy="afterInteractive" />}
      </body>
    </html>
  );
}
