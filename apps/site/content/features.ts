import type { PageMeta, Section } from "./types";

export const meta: PageMeta = {
  title: "Features: how VoidAccess investigations work",
  description:
    "Eight pipeline stages from a plain-English question to a graph of actors, malware and indicators, with enrichment, AI search, exports and a shared anonymous archive.",
};

export const hero = {
  title: "From a question to a graph, in eight stages",
  sub: "Every investigation runs the same open-source pipeline in its own isolated container.",
};

export const stages = [
  { name: "Refine", body: "An AI step rewrites your question into focused search queries." },
  { name: "Collect", body: "Queries run in parallel across Tor search engines, paste sites, code forges, security feeds and curated .onion seeds." },
  { name: "Filter", body: "Noisy and irrelevant results are dropped before anything is fetched." },
  { name: "Fetch", body: "Selected pages are fetched through Tor with response-size limits. Mandatory safety gates run on queries, URLs and content. No images or media are fetched." },
  { name: "Enrich", body: "Indicators are looked up in threat-intelligence sources for reputation, DNS, breach, sandbox and blockchain context." },
  { name: "Extract", body: "Entities are pulled out with pattern matching, NER and optional LLM analysis." },
  { name: "Graph", body: "Entities are linked into relationships, communities and infrastructure clusters." },
  { name: "Summarize", body: "A written summary and export-ready results close the run." },
];

export const entityTypes = [
  { category: "Cryptocurrency", examples: "Bitcoin, Ethereum, Monero, Litecoin, Zcash, Solana, Tron, ENS" },
  { category: "Network indicators", examples: "IP addresses, domains, URLs, .onion addresses, MAC addresses, PGP keys" },
  { category: "File indicators", examples: "MD5, SHA-1 and SHA-256 hashes, malware families" },
  { category: "Credentials (shown masked)", examples: "Cloud keys, tokens, JWTs, API keys, stealer-log and combo-list entries" },
  { category: "Messaging", examples: "Telegram, Discord, XMPP, Tox, Session, Matrix, Wire, ICQ, Wickr" },
  { category: "Vulnerabilities", examples: "CVEs, MITRE ATT&CK techniques and tactics, Exploit-DB IDs" },
  { category: "Detection content", examples: "YARA rules, Nuclei templates, Snort and Suricata indicators" },
  { category: "Threat intelligence", examples: "Actor handles, ransomware groups, paste links, people, organisations, locations" },
];

export const enrichment: Section = {
  heading: "Enrichment",
  paragraphs: [
    "Indicators are checked against threat feeds, IP and domain context, file and identity reputation, and blockchain data.",
    "Some enrichment sources need API keys or carry licence limits. The hosted service uses the sources we are licensed to run, so the set can differ from a self-hosted install.",
  ],
};

export const exportsSection = {
  heading: "Exports",
  body: "Take the results into the tools you already use.",
  formats: [
    { name: "STIX 2.1", note: "Pro and Pro+" },
    { name: "MISP", note: "Pro and Pro+" },
    { name: "IOC package", note: "Pro and Pro+" },
    { name: "Sigma, YARA, Snort, Suricata", note: "where rules can be generated; Pro and Pro+" },
    { name: "CSV and JSON", note: "every plan" },
    { name: "Markdown report", note: "every plan" },
  ],
};

export const aiSearch: Section = {
  heading: "AI-assisted search",
  paragraphs: [
    "You don't need to know dork syntax or which engine indexes what. Describe what you want to know and the refine stage turns it into queries.",
    "We guarantee these sources and formats. We can't guarantee every mention on the dark web will be found. Nobody honestly can.",
  ],
};

export const archive: Section = {
  heading: "The archive",
  paragraphs: [
    "Your searches and investigations are private to your account. Findings (indicators, actors, sources and when we saw them) go into a shared, anonymous, dated archive. Nothing in it records who searched or what they typed.",
    "The archive enriches future searches, including with things that are no longer live on the original source. Read the disclosure on the Trust page.",
  ],
};
