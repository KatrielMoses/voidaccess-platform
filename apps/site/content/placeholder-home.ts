/**
 * Used only while the site runs in "minimal" mode (SITE_MODE=minimal): the placeholder home page, and the lean
 * header and footer that go with it. The full marketing site ignores this file.
 */
export const placeholderHome = {
  meta: { title: "VoidAccess Cloud", description: "VoidAccess Cloud: dark-web OSINT in your browser." },
  line: "VoidAccess Cloud: dark-web OSINT in your browser.",
  signIn: "Sign in",
  createAccount: "Create account",
  github: "GitHub",
  legal: [
    { label: "Terms", href: "/terms" },
    { label: "Privacy", href: "/privacy" },
    { label: "Acceptable use", href: "/acceptable-use" },
  ],
  footerLine: "VoidAccess is built for authorised security research and defence.",
} as const;
