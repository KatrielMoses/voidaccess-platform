import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Script from "next/script";
import { Attribution } from "@/components/attribution";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { JsonLd } from "@/components/json-ld";
import { getStars } from "@/lib/github";
import { organizationLd } from "@/lib/jsonld";
import { SITE_URL } from "@/lib/site";
import { siteContent } from "@content/site";
import "./globals.css";

// Self-hosted by next/font with size-adjusted fallbacks, so swapping fonts doesn't shift layout.
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "optional" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "optional", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "VoidAccess", template: "%s" },
  description: siteContent.defaultDescription,
  applicationName: "VoidAccess",
  authors: [{ name: "Katriel Moses" }],
  icons: { icon: "/logo-96.png", apple: "/logo-96.png" },
};

export const viewport: Viewport = { themeColor: "#080b11", colorScheme: "dark" };

const PLAUSIBLE_ON = process.env.NODE_ENV === "production" && process.env.PLAUSIBLE_DISABLED !== "1";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const stars = (await getStars()) ?? siteContent.githubStarsFallback;
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-fg-inverse">
          Skip to content
        </a>
        <Header stars={stars} />
        <main id="main">{children}</main>
        <Footer />
        <Attribution />
        <JsonLd data={organizationLd()} />
        {PLAUSIBLE_ON && <Script src="/pl/script.js" data-domain="voidaccess.pro" data-api="/pl/event" strategy="afterInteractive" />}
      </body>
    </html>
  );
}
