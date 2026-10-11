export const siteContent = {
  tagline: "Dark-web threat intelligence, without the dark web.",
  defaultDescription:
    "Hosted VoidAccess: AI-assisted dark-web search, enrichment, an entity and actor graph, and exports. Nothing to install, no Tor to run, no keys to manage.",
  nav: [
    { label: "Features", href: "/features" },
    { label: "Pricing", href: "/pricing" },
    { label: "Trust", href: "/trust" },
  ],
  cta: { join: "Join waitlist", joinLong: "Join the waitlist / founding seats", pricing: "See pricing" },
  /** Shown only if the live GitHub star count can't be fetched. Last checked 2026-10-12. */
  githubStarsFallback: 789,
  footer: {
    product: [
      { label: "Features", href: "/features" },
      { label: "Pricing", href: "/pricing" },
      { label: "Join the waitlist", href: "/waitlist" },
      { label: "Open source", href: "/open-source" },
    ],
    legal: [
      { label: "Terms", href: "/terms" },
      { label: "Privacy", href: "/privacy" },
      { label: "Acceptable use", href: "/acceptable-use" },
      { label: "Trust", href: "/trust" },
    ],
    also: "Also by Katriel: MailAccess",
    socials: [
      { label: "X / Twitter (coming soon)", href: null },
      { label: "LinkedIn (coming soon)", href: null },
    ],
    legalLine: "VoidAccess is built for authorised security research and defence.",
  },
  notFound: {
    title: "That page isn't here",
    body: "It may have moved, or it may never have existed. The pages that do exist are linked below.",
  },
} as const;
