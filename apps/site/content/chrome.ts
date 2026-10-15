/**
 * The header and footer around the sign-in, legal and 404 pages. They match the home page (src/home/index.html,
 * copied from website-mockups/site), so keep the words here in step with its nav and footer.
 */
const repo = "https://github.com/KatrielMoses/voidaccess";

export const chrome = {
  homeLabel: "VoidAccess home",
  github: { label: "GitHub", href: repo },
  footerLine: "Open-source dark-web OSINT. Self-hosted, MIT licensed.",
  footerLinks: [
    { label: "GitHub", href: repo },
    { label: "Docs", href: `${repo}#readme` },
    { label: "Security", href: `${repo}/blob/main/SECURITY.md` },
    { label: "MIT License", href: `${repo}/blob/main/LICENSE` },
  ],
} as const;
