import type { Faq, PageMeta } from "./types";

export const meta: PageMeta = {
  title: "VoidAccess: dark-web threat intelligence, without the dark web",
  description:
    "Hosted VoidAccess: AI-assisted dark-web search, enrichment, an entity and actor graph, and exports. Nothing to install, no Tor to run, no keys to manage.",
};

export const hero = {
  eyebrow: "Early access · founding seats open",
  title: "Dark-web threat intelligence, without the dark web.",
  sub: "Ask a question in plain English. VoidAccess searches dark-web and open-web sources, enriches what it finds, and hands you a graph of actors, malware, indicators and exports. You install nothing, run no Tor, and hold no keys.",
  note: "Free plan: {{free.credits}} credits, no card. Founding seats: {{founding.price}}/mo for the first {{founding.seats}} paying members.",
  graphCaption:
    "A real investigation, redacted. Public group, malware and CVE names are kept; onion addresses and handles are replaced with generated ones.",
  graphAlt:
    "An animated graph. At its centre, the Cl0p ransomware group connects to seven CVEs it is reported to exploit. Around it, other groups connect to the AvNeutralizer tool, FIN7 to NetSupport RAT, and a handle and two onion services link to groups and malware.",
};

export const pillars = [
  {
    name: "Coverage",
    body: "One question fans out in parallel across 16+ Tor search engines, paste sites, code forges, security feeds and curated .onion seeds. Pages are fetched for you, through Tor, on our side.",
  },
  {
    name: "Context",
    body: "Indicators are enriched with threat-feed, DNS, reputation and blockchain context where the sources allow. Entities and actors are linked into a graph you can filter and follow.",
  },
  {
    name: "Control",
    body: "You pick the depth and see the credit cost before you run. Credentials are shown masked. No images or media from dark-web pages are ever fetched. Export to STIX 2.1, MISP, CSV, JSON and more.",
  },
];

export const steps = [
  { title: "Ask", body: "Describe what you want to know: a group, a domain, a handle, a wallet, your own company's name. An AI step refines it into good search queries." },
  { title: "We run it", body: "Each investigation runs in its own short-lived, isolated container with its own Tor client. Nothing touches your machine or network." },
  { title: "Read and export", body: "Browse the summary, the entity and actor graph, and the sources with dates. Export the indicators into the tools you already use." },
];

export const compare = {
  heading: "Hosted, or install it yourself",
  intro: "The engine is open source. Self-hosting is free forever. The hosted service is for people who'd rather not run it.",
  columns: ["", "VoidAccess Cloud", "Self-host (open source)"],
  rows: [
    ["Setup", "None. Sign in and ask.", "Install, configure, keep it updated."],
    ["Tor", "Runs on our side. No dark-web traffic touches your machine.", "You run Tor from your own network."],
    ["API keys", "Nothing to obtain or hold.", "You bring your own keys for sources that need them."],
    ["Cost", "A free plan, then paid plans. See pricing.", "Free forever (MIT licence)."],
    ["Shared archive", "Findings enrich future searches (anonymous, dated).", "Your data stays on your machine."],
    ["Source code", "The engine is open; the cloud platform is not.", "All of it, on GitHub."],
  ],
};

export const proof = {
  heading: "Open source, in the open",
  starsLabel: "GitHub stars",
  downloadsLabel: "PyPI downloads last month",
  /** Hidden until real. Set visible: true and fill items when there is something genuine to show. */
  featuredBy: { visible: false, label: "As featured by", items: [] as { name: string; href: string }[] },
};

export const founder = {
  heading: "Built by a security researcher",
  body: "VoidAccess is built by Katriel Moses, who discovered CVE-2026-50112 (an Apache CloudStack remote code execution flaw) and wrote MailAccess, an open-source email security tool.",
  links: [
    { label: "CVE-2026-50112", href: "https://nvd.nist.gov/vuln/detail/CVE-2026-50112" },
    { label: "MailAccess on GitHub", href: "https://github.com/KatrielMoses/MailAccess" },
  ],
};

export const faq: Faq[] = [
  {
    q: "Do I need to run Tor or install anything?",
    a: "No. Investigations run on our servers inside isolated, short-lived containers. You use a browser. No dark-web traffic touches your machine or network.",
  },
  {
    q: "What does it cost?",
    a: "A free plan with {{free.credits}} credits a month and no card. Pro is {{founding.price}}/mo at the founding price for the first {{founding.seats}} subscribers ({{pro.monthly}}/mo after that) and Pro+ is {{plus.monthly}}/mo, with annual billing that gives {{pro.monthsFree}} months free. A Standard investigation costs {{depth.standard}} credits. Full details are on the pricing page.",
  },
  {
    q: "Will it find everything about my organisation?",
    a: "We guarantee these sources and formats. We can't guarantee every mention on the dark web will be found. Nobody honestly can.",
  },
  {
    q: "Are my searches private?",
    a: "Yes. Your searches and investigations are private to your account. Findings (never who searched, or what they typed) go into a shared, anonymous, dated archive that enriches future searches. The Trust page explains exactly how.",
  },
  {
    q: "Do you show credentials that were leaked?",
    a: "Credentials found in sources are shown masked. Raw values are encrypted and never shown by default.",
  },
  {
    q: "Can I self-host instead?",
    a: "Yes. The engine is MIT-licensed and free to self-host forever. The hosted service is the same engine, run for you.",
  },
];

export const finalCta = {
  title: "Get a seat before launch",
  body: "Join the waitlist to hear the day the app opens. Founding members get {{founding.price}}/mo, kept every year they stay active.",
};
