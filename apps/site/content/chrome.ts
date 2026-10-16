/**
 * The header and footer around the sign-in, legal and 404 pages. They match the home page (src/home/index.html), so
 * keep the words here in step with its nav and footer.
 */
export const chrome = {
  homeLabel: "VoidAccess home",
  signIn: { label: "Sign in", href: "/sign-in" },
  start: { label: "Start free", href: "/sign-in" },
  footerLine: "Dark-web OSINT in your browser.",
  support: { label: "support@voidaccess.pro", href: "mailto:support@voidaccess.pro" },
  pricing: { label: "Pricing", href: "/pricing" },
  footerLinks: [
    { label: "Terms", href: "/terms", external: false },
    { label: "Privacy", href: "/privacy", external: false },
    { label: "Acceptable use", href: "/acceptable-use", external: false },
    { label: "GitHub", href: "https://github.com/KatrielMoses/voidaccess", external: true },
  ],
} as const;
