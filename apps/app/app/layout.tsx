import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { ToastProvider, TooltipProvider } from "@voidaccess/ui";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--nf-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--nf-body", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--nf-mono", display: "swap" });

export const metadata: Metadata = {
  title: "VoidAccess",
  description: "VoidAccess platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-void font-sans text-fg antialiased">
        <TooltipProvider>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
