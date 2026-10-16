import { EFFECTIVE, SUPPORT_EMAIL, legalNote } from "./legal-common";
import type { LegalPage } from "./types";

export const page: LegalPage = {
  meta: {
    title: "Terms of service: VoidAccess",
    description: "The terms for using VoidAccess Cloud, the hosted threat-intelligence research service, and its subscriptions.",
  },
  title: "Terms of service",
  updated: EFFECTIVE,
  note: legalNote,
  intro:
    "These terms are an agreement between you and Katriel Moses, who operates VoidAccess Cloud (\"VoidAccess\", \"we\", \"us\"). They cover the hosted service at app.voidaccess.pro, this website, and paid subscriptions and credit packs. By creating an account or using the service you agree to them, to the Acceptable use policy and to the Privacy policy.",
  sections: [
    {
      heading: "The service",
      paragraphs: [
        "VoidAccess is a hosted cyber threat-intelligence research tool. You enter a research topic, for example a ransomware group, a malware family or a CVE. VoidAccess searches publicly reachable sources, including onion search engines, GitHub, security research feeds and threat-intelligence lookups. It extracts indicators such as domains, IP addresses, hashes, CVEs and threat-actor names, links them in a graph, writes a summary with its sources, and lets you export the result to formats such as STIX 2.1, MISP, Sigma, YARA, Snort, Suricata, CSV and JSON.",
        "VoidAccess only reads publicly reachable pages. It never logs in to, scans, probes or accesses any system. It is built on the open-source VoidAccess engine (MIT licence).",
      ],
    },
    {
      heading: "Who can use it",
      bullets: [
        "You must be at least 18 and able to enter a binding contract.",
        "The service is for security, threat-intelligence, research, journalism and law-enforcement work. If you use it for an organisation, you confirm you are allowed to accept these terms for it.",
        "You must not use the service if you are in a country or on a list subject to comprehensive sanctions, or where accessing the sources it searches is illegal for you.",
      ],
    },
    {
      heading: "Your account",
      bullets: [
        "You sign in with an emailed one-time code or with a supported sign-in provider such as GitHub. The first sign-in creates your account.",
        "Keep access to your email and sign-in provider secure. You are responsible for activity on your account.",
        "Before your first investigation you must accept the Acceptable use policy. We record when you did.",
      ],
    },
    {
      heading: "Acceptable use",
      paragraphs: [
        "You must follow the Acceptable use policy. In short: defensive and research use only; no targeting, harassing or doxxing people; no attempts to bypass the content-safety filters; and no use of the AI features to produce sexual, NSFW or other prohibited content. We may suspend or close accounts that break it, without refund where the breach is serious.",
      ],
    },
    {
      heading: "AI-assisted features",
      paragraphs: [
        "VoidAccess uses large language models to refine your research question, extract indicators from collected text, and write the investigation summary. These features produce text only. There is no image, video or audio generation, and no chat or companion feature.",
        "AI output can be wrong, incomplete or misleading, and sources themselves may be unreliable or deliberately deceptive. Verify findings before you act on them.",
      ],
    },
    {
      heading: "Plans, credits and pricing",
      bullets: [
        "Current plans and prices are on the Pricing page. Prices are in US dollars and exclude any taxes added at checkout.",
        "Plans include monthly credits. Investigations cost credits: a Quick investigation costs {{depth.quick}} credits and a Standard one {{depth.standard}}. Viewing results and exporting cost nothing.",
        "Monthly credits reset each billing month and do not roll over. Top-up credits are used after monthly credits and expire {{topup.expiryMonths}} months after purchase.",
        "Investigations that fail, or that you cancel, are refunded in credits automatically.",
        "The Free plan gives {{free.credits}} credits a month with no card. We may change free allowances with notice.",
      ],
    },
    {
      heading: "Payments, renewal and cancellation",
      bullets: [
        "Payments are processed by Creem, our merchant of record, which sells to you on our behalf, collects any applicable taxes and issues your receipts. Creem's checkout terms also apply to your purchase.",
        "Subscriptions renew automatically at the end of each monthly or annual period until you cancel.",
        "You can cancel at any time from Billing in the app. Cancellation takes effect at the end of the period you have paid for, and you keep your plan until then.",
        `Refunds: if you are not satisfied, email ${SUPPORT_EMAIL} within 14 days of a payment and we will refund it in full, as long as you have not used the credits that payment bought. Otherwise, payments are not refundable except where the law requires.`,
        "If we raise a plan's price, we will tell you at least 30 days before it applies to your next renewal.",
      ],
    },
    {
      heading: "Founding seats",
      paragraphs: ["{{founding.copy}}"],
      bullets: [
        "The first {{founding.seats}} paid Pro subscribers get {{founding.price}}/mo, with the same credits as Pro, for {{founding.termMonths}} months from the first payment. It is not a lifetime price.",
        "At each anniversary the seat renews for another {{founding.termMonths}} months at {{founding.price}} if you paid for at least {{founding.renewalMonths}} of the previous {{founding.termMonths}} months. Otherwise it is released and you move to Pro at {{founding.proPrice}}/mo, or to Free if you have left.",
        "If you run no investigations for {{founding.inactivityMonths}} consecutive months, the seat is released early with the same outcome. We email you {{founding.noticeDays}} days before a release and on the day.",
        "Founding seats are monthly billing only. Upgrading to Pro+ ends the founding price.",
      ],
    },
    {
      heading: "Your data and the shared archive",
      paragraphs: [
        "Your queries, investigations and reports are private to your account, and you can export or delete them. You give us permission to process them to run the service.",
        "Findings from investigations (indicators and source references, never your identity or your query text) are added to a shared, anonymous, dated archive that improves future results for everyone. Credentials and personal data in findings are masked. How we handle personal data is described in the Privacy policy.",
      ],
    },
    {
      heading: "Third-party sources",
      paragraphs: [
        "VoidAccess shows information collected from sources we do not control. That content may be offensive, false or unlawful. We do not endorse it. Mandatory filters remove certain prohibited material (see the Acceptable use policy), but no filter is perfect. Report anything that should not be there to " + SUPPORT_EMAIL + ".",
      ],
    },
    {
      heading: "Suspension and termination",
      paragraphs: [
        "You can delete your account at any time from Settings. We may suspend or close an account that breaks these terms or the Acceptable use policy, that creates legal risk, or that we reasonably believe is being used for abuse. Where we can, we will tell you why. If we close a paid account without cause, we refund the unused part of the current period.",
      ],
    },
    {
      heading: "Disclaimer and liability",
      paragraphs: [
        "The service is provided as is and as available, without warranties of any kind, to the extent the law allows. We do not guarantee that it will find every relevant mention or that results are accurate.",
        "To the extent the law allows, we are not liable for indirect or consequential losses, and our total liability for any claim is limited to the greater of the amount you paid us in the 12 months before the claim and one hundred US dollars. Nothing in these terms limits liability that cannot be limited by law.",
      ],
    },
    {
      heading: "Changes, law and contact",
      paragraphs: [
        "We may update these terms. For material changes we will email account holders at least 14 days before they take effect. Continuing to use the service after that means you accept the new terms.",
        "These terms are governed by the laws of India, and the courts of Bengaluru, Karnataka have jurisdiction, unless the law where you live gives you the right to bring a claim there.",
        `Contact: ${SUPPORT_EMAIL}.`,
      ],
    },
  ],
};
