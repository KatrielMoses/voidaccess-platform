import { EFFECTIVE, SUPPORT_EMAIL, legalNote } from "./legal-common";
import type { LegalPage } from "./types";

export const page: LegalPage = {
  meta: {
    title: "Acceptable use policy: VoidAccess",
    description:
      "What VoidAccess Cloud may and may not be used for, including its AI-assisted research and report generation, and the content controls that enforce it.",
  },
  title: "Acceptable use policy",
  updated: EFFECTIVE,
  note: legalNote,
  intro:
    "VoidAccess Cloud is a defensive threat-intelligence research service with AI-assisted research and report generation. Every user must accept this policy before running an investigation, and it applies to everything you do with the service, its AI features and its outputs. It is part of the Terms of service.",
  sections: [
    {
      heading: "What VoidAccess is",
      paragraphs: [
        "VoidAccess is a passive research tool. It reads publicly reachable pages, including onion sites, code repositories and security feeds, and turns them into threat-intelligence reports. It does not exploit, scan or log in to systems, does not de-anonymise anyone, and provides no attack capability.",
      ],
    },
    {
      heading: "Who it is for",
      paragraphs: [
        "People whose work is understanding threats in order to defend against them: threat-intelligence analysts, security operations and incident-response teams, penetration testers working within an authorised scope, journalists and academic researchers, and law enforcement acting with proper authority.",
      ],
    },
    {
      heading: "Permitted uses",
      bullets: [
        "Researching threat actors, ransomware groups, malware families and vulnerabilities for defensive purposes.",
        "Collecting indicators of compromise to feed detection and blocking tools.",
        "Monitoring for mentions of your own organisation, brands, domains, employees or data.",
        "Writing threat-intelligence reports for internal use, or for clients under an authorised engagement.",
        "Academic and journalistic research into cybercrime.",
      ],
    },
    {
      heading: "Prohibited uses",
      bullets: [
        "Targeting, stalking, harassing, threatening, extorting or doxxing any person or organisation.",
        "Using the service as a people-search tool, or to compile profiles of private individuals.",
        "Using any credential, personal data or access found through the service to access accounts or systems, or helping anyone else do so.",
        "Planning, supporting or carrying out attacks, fraud or any other crime, or feeding results into offensive tooling.",
        "Searching for, accessing or distributing illegal content, including child sexual abuse material, or trying to bypass the content-safety filters.",
        "Investigating an organisation for a client without documented authorisation.",
        "Reselling access or outputs, or automating use of the service beyond normal personal use, without our written agreement.",
        "Using the service where accessing the sources it searches is illegal for you.",
      ],
    },
    {
      heading: "AI-assisted features",
      paragraphs: [
        "VoidAccess uses large language models for three tasks only: refining your research question into search queries, extracting indicators from collected text, and writing a factual summary of what the investigation found, with its sources. You supply a research topic. You cannot give the models free-form instructions, and VoidAccess is not a general-purpose chatbot.",
        "The AI features generate text only. VoidAccess has no image, video, voice or audio generation, no face or likeness tools, and no chat, companion or role-play features.",
      ],
    },
    {
      heading: "Sexual, NSFW and other prohibited AI content",
      paragraphs: ["You must not use VoidAccess, its AI features or its outputs to create, request or distribute:"],
      bullets: [
        "Sexually explicit, pornographic or other NSFW content of any kind, including erotic text.",
        "Any sexual content involving minors. This is never permitted, under any circumstances, and we report it to the authorities.",
        "Gore, graphic violence or content that glorifies harm.",
        "Hateful, harassing or threatening content about any person or group.",
        "Content that impersonates a real person, or deceptive content meant to defraud or mislead.",
      ],
    },
    {
      heading: "How content is controlled",
      bullets: [
        "Fixed purpose: the models only receive the research topic and the collected source text, under fixed instructions to write a threat-intelligence summary. You cannot steer them to write other kinds of content.",
        "Mandatory filters run at four points: on the query you enter, on every source address before it is fetched, on page text before it is processed, and on extracted values before they are stored. They block child sexual abuse material, gore and snuff content, and related terms. Flagged queries are refused and flagged pages are dropped; they are never stored, shown or sent to the AI models. The filters cannot be turned off.",
        "No media: VoidAccess never downloads, stores or shows images, video or other media from sources. Reports are text and structured data only.",
        "Masking: credentials and personal data found in sources are masked in the app and in every export.",
        "Safety logging and review: filter events are logged as metadata only (never the content itself) and reviewed. Accounts that trigger the filters repeatedly, or that try to produce prohibited content, are suspended.",
        "Account controls: every user signs in with a verified email or sign-in provider, accepts this policy before their first run, and is subject to rate limits and abuse monitoring.",
      ],
    },
    {
      heading: "Your responsibility",
      paragraphs: [
        "You are responsible for complying with the law where you are, for having authorisation before investigating organisations that are not yours, and for handling what you find responsibly. Results can be incomplete, wrong or deliberately misleading, and AI-written summaries can contain errors. Verify before you act.",
      ],
    },
    {
      heading: "Enforcement",
      paragraphs: [
        "If you break this policy we may refuse a query, remove content, suspend or close your account, and, where the law requires or the harm is serious, report it to the authorities. Serious breaches are not refunded.",
      ],
    },
    {
      heading: "Reporting misuse",
      paragraphs: [
        `If you see VoidAccess used against this policy, or find content in it that should not be there, email ${SUPPORT_EMAIL}. We review every report and reply within 3 business days.`,
      ],
    },
  ],
};
