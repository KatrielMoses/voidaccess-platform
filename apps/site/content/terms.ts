import type { LegalPage } from "./types";

const draftNotice = "Draft, pending legal review. This page is not yet legally binding and will change before launch.";

export const page: LegalPage = {
  meta: { title: "Terms of service (draft): VoidAccess", description: "Draft terms of service for VoidAccess Cloud, pending legal review." },
  title: "Terms of service",
  updated: "Draft of 2026-10-12",
  draftNotice,
  intro: "These draft terms describe how VoidAccess Cloud is meant to work. They are a starting point for legal review, not a finished contract.",
  sections: [
    { heading: "The service", paragraphs: ["VoidAccess Cloud is a hosted version of the open-source VoidAccess engine. You describe a topic; we search sources, enrich and extract findings, and give you the results. You are responsible for how you use them."] },
    { heading: "Your account and acceptable use", paragraphs: ["You must use the service lawfully and in line with the Acceptable use policy. We may suspend or end accounts that break it. The content filters can't be disabled and attempts to bypass them are a breach."] },
    { heading: "Credits, plans and payments", bullets: [
      "Plans give monthly credits that reset each month and don't roll over. A Quick investigation costs {{depth.quick}} credits and a Standard one {{depth.standard}}.",
      "Top-up credits are used after monthly credits and expire {{topup.expiryMonths}} months after purchase.",
      "Failed or cancelled runs are refunded in credits.",
      "Paid plans renew until cancelled. Cancelling takes effect at the end of the paid period.",
      "Payments are handled by a merchant of record, who may collect taxes and provide receipts.",
    ] },
    { heading: "Founding seats", paragraphs: ["{{founding.copy}}"], bullets: [
      "The first {{founding.seats}} paid Pro subscribers get {{founding.price}}/mo, with the same credits as Pro, for {{founding.termMonths}} months from the first payment. It is not a lifetime price.",
      "At each anniversary the seat renews for another {{founding.termMonths}} months at {{founding.price}} if you paid for at least {{founding.renewalMonths}} of the previous {{founding.termMonths}} months. Otherwise it is released and you move to Pro at {{founding.proPrice}}/mo, or to Free if you have left.",
      "If you run no investigations for {{founding.inactivityMonths}} consecutive months, the seat is released early with the same outcome.",
      "We email you {{founding.noticeDays}} days before a release and on the day of release. Released seats return to the pool.",
      "Founding seats are monthly billing only. Upgrading to Pro+ ends the founding price.",
    ] },
    { heading: "The shared archive", paragraphs: ["Your searches and investigations are private. By using the service you agree that findings from them may be added to a shared, anonymous, dated archive that enriches future searches. The archive holds no user identity and no query text, and is permanent. See the Trust page."] },
    { heading: "No guarantee of completeness", paragraphs: ["We can't guarantee every mention on the dark web will be found. Sources may be unreliable or deliberately misleading. Results are provided as is, without warranty; verify before acting."] },
    { heading: "Liability", paragraphs: ["To the extent the law allows, our liability is limited to the amount you paid in the previous 12 months. [Jurisdiction, governing law and limitation wording to be set by counsel.]"] },
    { heading: "Changes and contact", paragraphs: ["We'll tell account holders before material changes. Questions about these terms: [contact address to be set by counsel]."] },
  ],
};
