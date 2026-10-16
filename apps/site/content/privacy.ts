import { EFFECTIVE, SUPPORT_EMAIL, legalNote } from "./legal-common";
import type { LegalPage } from "./types";

export const page: LegalPage = {
  meta: {
    title: "Privacy policy: VoidAccess",
    description: "How VoidAccess Cloud handles personal data for customer accounts, investigations, payments and this website.",
  },
  title: "Privacy policy",
  updated: EFFECTIVE,
  note: legalNote,
  intro:
    "This policy explains what personal data VoidAccess Cloud collects, why, who processes it and the choices you have. It covers customer accounts, investigations and payments in the app at app.voidaccess.pro, and this website. VoidAccess is operated by Katriel Moses, who is responsible for your data (the data controller, or data fiduciary under India's Digital Personal Data Protection Act).",
  sections: [
    {
      heading: "What we collect about you",
      bullets: [
        "Account: your email address, an optional display name, how you sign in (email code, or the GitHub, Google or Microsoft account you connect, with its public profile name and avatar), and when you accepted the Acceptable use policy.",
        "Sessions and security: for each signed-in session, the IP address and browser user agent, so you can sign out of other devices and we can spot account abuse. Rate-limit and abuse records keep only a one-way hash of your IP address.",
        "Your investigations: the research queries you enter, the resulting reports, findings and exports, and their credit cost.",
        "Billing: your plan, credit balance and history, and payment status. Card and payment details are collected by our payment provider, Creem; we never see or store your card number.",
        "Product events: a small set of first-party events, such as account created, investigation started and export used, tied to your account. They hold no IP address and no user agent. We use no third-party trackers or advertising cookies in the app.",
        "Support: what you send us when you email us.",
        "Attribution, only with your consent: if you agree to the prompt on this website, the link that first brought you here (campaign tags, referrer, landing page and time), saved with your account when you sign up.",
      ],
    },
    {
      heading: "Personal data found in research sources",
      paragraphs: [
        "The sources VoidAccess searches can contain personal data about other people, such as email addresses, usernames or leaked credentials. We process it only to produce threat-intelligence results. Credentials and personal data are masked in the app and in every export. Credential values that are kept for security analysis are encrypted with a managed key and never shown in full. Personal identifiers such as names, phone numbers and addresses are never added to the shared archive.",
        `If you believe the service holds information about you, email ${SUPPORT_EMAIL} and we will review and remove it where appropriate.`,
      ],
    },
    {
      heading: "Why we use it",
      bullets: [
        "To provide the service you signed up for: your account, investigations, credits, billing and support (performance of our contract with you).",
        "To keep the service secure and prevent abuse, fraud and breaches of the Acceptable use policy (our legitimate interest, and legal obligations).",
        "To send service email, such as sign-in codes, receipts, credit alerts and notices about your account (performance of contract).",
        "To send optional product email, only if you opt in, with an unsubscribe link in every message (consent).",
        "To understand which channels bring users, only if you agree to the attribution prompt (consent).",
      ],
    },
    {
      heading: "The shared archive",
      paragraphs: [
        "Findings from investigations, meaning indicators and source references, are added to a shared, anonymous, dated archive that improves future results. The archive never contains your identity, your account or your query text, and credentials and personal identifiers are masked or removed before anything is added. Because it holds no personal data about you, archive entries are kept when you delete your account.",
      ],
    },
    {
      heading: "Who processes it for us",
      paragraphs: ["We use these service providers, each only to run VoidAccess on our behalf:"],
      bullets: [
        "Google Cloud: application hosting, file storage and encryption keys (United States).",
        "Neon: the application database.",
        "Cloudflare: this website, content delivery and bot protection (Turnstile).",
        "Resend: sending email.",
        "OpenRouter and the AI model providers it routes to: refining queries, extracting indicators and writing summaries. They receive your research query and the collected source text, never your account details.",
        "Creem: payments, as merchant of record. Creem processes your payment details and billing address under its own privacy policy.",
        "GitHub, Google or Microsoft: only if you choose to sign in with them.",
      ],
    },
    {
      heading: "International transfers",
      paragraphs: [
        "VoidAccess is operated from India and its servers run in the United States. Your data may be processed in India, the United States and other countries where our providers operate, under safeguards such as standard contractual clauses where required.",
      ],
    },
    {
      heading: "How long we keep it",
      bullets: [
        "Account and investigation data: while your account is open. When you delete your account, your investigations, reports, sessions and sign-in details are deleted, and your email is anonymised.",
        "Billing records: the credit ledger is kept in anonymised form, and payment records are kept by Creem, for as long as tax and accounting law requires.",
        "Security logs: kept for a limited period, then deleted.",
        "Free-plan investigation history: 7 days; paid plans keep history while subscribed.",
      ],
    },
    {
      heading: "Your rights and choices",
      bullets: [
        "Download everything we hold about you as JSON, any time, from Settings in the app.",
        "Correct your name in Settings, or email us to correct anything else.",
        "Delete your account and its data, any time, from Settings.",
        "Withdraw consent for product email or attribution at any time; it does not affect earlier processing.",
        "Object to processing, ask us to restrict it, or nominate someone to act for you, where the law gives you that right.",
        `Email ${SUPPORT_EMAIL} for any request or complaint. We reply within 3 business days and act within 30 days. You can also complain to your data protection authority, or in India to the Data Protection Board.`,
      ],
    },
    {
      heading: "Cookies",
      paragraphs: [
        "The app uses one essential cookie to keep you signed in. This website stores the first-touch attribution described above in your browser's local storage only if you agree. We use no advertising or cross-site tracking cookies.",
      ],
    },
    {
      heading: "Children, security and changes",
      paragraphs: [
        "VoidAccess is not for anyone under 18, and we do not knowingly collect their data.",
        "We protect data with encryption in transit and at rest, database-level isolation between customer accounts, least-privilege access and audit logging. If a breach affects your personal data, we will tell you and the relevant authorities as the law requires.",
        "We will post changes here and email account holders about material ones before they take effect.",
      ],
    },
  ],
};
