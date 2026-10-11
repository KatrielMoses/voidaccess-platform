import type { PageMeta, Section } from "./types";

export const meta: PageMeta = {
  title: "Trust: how VoidAccess handles safety, data and disclosure",
  description:
    "What VoidAccess covers and doesn't, content safety, masking, retention, tenant isolation, the shared anonymous archive, and how to report a security issue.",
};

export const hero = {
  title: "Trust, in plain words",
  sub: "What we do, what we can't do, and where your data goes.",
};

export const sections: Section[] = [
  {
    id: "usage-policy",
    heading: "Usage policy, in short",
    paragraphs: [
      "VoidAccess is a passive OSINT tool for people who defend against threats: threat intelligence analysts, SOC teams, penetration testers within authorised scope, law enforcement, and academic researchers. It collects publicly accessible information. It does not exploit systems or de-anonymise anyone.",
      "You must not use results to target, harass, extort or dox anyone; run investigations for third parties without authorisation; try to reach illegal content or bypass the content filter; or feed results into offensive tooling. The full text is on the Acceptable use page.",
    ],
  },
  {
    id: "coverage",
    heading: "What we cover, and what we don't",
    paragraphs: [
      "We guarantee these sources and formats. We can't guarantee every mention on the dark web will be found. Nobody honestly can.",
    ],
    bullets: [
      "Covered: 16+ Tor search engines, paste sites, code forges, security feeds and curated .onion seeds, plus the exports listed on the Features page.",
      "Not covered: private or invite-only forums and channels, content behind logins, and anything the safety gates block.",
      "Sources go offline, move and lie. Threat actors plant false information, so verify intelligence before you act on it.",
      "Relationship edges between entities are leads, not facts. For example, a group and an organisation mentioned in the same article are not necessarily attacker and victim. We don't offer victim attribution, and the graph shouldn't be read that way.",
      "Occasionally a late stage (such as the summary) times out and a run returns partial results. Failed runs are refunded automatically.",
    ],
  },
  {
    id: "content-safety",
    heading: "Content safety",
    paragraphs: [
      "Mandatory filters block queries, URLs and content related to child sexual abuse material, gore, snuff content and other illegal or harmful categories. They run at query intake, URL validation, content scraping and after extraction, and they can't be switched off.",
    ],
    bullets: [
      "No images or media from dark-web pages are ever fetched or shown. We work with text only.",
      "Credentials found in sources are shown masked. Raw values are encrypted and never shown by default.",
      "Prohibited content is meant to be stopped before it reaches the AI step, the summary or the archive.",
    ],
  },
  {
    id: "retention",
    heading: "Data retention",
    bullets: [
      "Your investigations are kept while your account is active and are deleted with it.",
      "The shared archive is anonymous and permanent. It holds findings, never who searched or what they typed. See the archive disclosure below.",
      "Waitlist emails are kept until you ask us to remove them.",
    ],
  },
  {
    id: "isolation",
    heading: "Tenant isolation",
    paragraphs: [
      "Each investigation runs in its own short-lived container with its own Tor client and a throwaway database. There is no shared engine process or cache between customers. Platform records are tied to your account and every query is scoped to it.",
    ],
  },
  {
    id: "archive",
    heading: "Archive disclosure",
    paragraphs: [
      "Your searches and investigations are private. Findings from them (indicators, actors, relationships, sources and the dates we saw them) are added to a shared archive that enriches future searches for everyone, including with findings from sources that have since disappeared.",
      "The archive is anonymous: it stores no user identity and no query text. It is permanent and dated. If you believe something in it must be removed, contact us; we handle legal removal requests case by case.",
    ],
  },
  {
    id: "credentials",
    heading: "Credential handling",
    paragraphs: [
      "Credentials that appear in sources are masked in the interface and exports. The raw value is encrypted at rest and is not shown by default. We don't use leaked credentials to access anything.",
    ],
  },
  {
    id: "audits",
    heading: "Audit history",
    paragraphs: [
      "The engine is open source under the MIT licence, so anyone can read it. Release audits and the usage policy are published in the repository's docs folder. The hosted platform has not been through an independent certification or audit, and we don't claim one.",
    ],
  },
  {
    id: "disclosure",
    heading: "Responsible disclosure",
    paragraphs: [
      "Report vulnerabilities through GitHub private vulnerability reporting on the repository, or by email to the address below. Include what you found, steps to reproduce, the affected component and the impact.",
      "We acknowledge within 48 hours, send status updates within 7 days, and fix confirmed issues before public disclosure. We credit reporters unless they prefer anonymity, and we don't take legal action against good-faith researchers who follow this policy.",
    ],
  },
];

export const contact = { security: "katriel.moses@gmail.com", label: "Security contact" };
