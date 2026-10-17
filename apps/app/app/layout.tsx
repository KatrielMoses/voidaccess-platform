import type { Metadata } from "next";
import { ToastProvider, TooltipProvider } from "@voidaccess/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoidAccess",
  description: "VoidAccess platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/GeneralSans-400.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/GeneralSans-500.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/GeistMono-400.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/Sora-500.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body className="min-h-screen bg-bg font-sans text-paper">
        <TooltipProvider>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
