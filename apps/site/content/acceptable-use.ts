import type { LegalPage } from "./types";

export const page: LegalPage = {
  meta: { title: "Acceptable use policy (draft): VoidAccess", description: "Draft acceptable use policy for VoidAccess Cloud, based on the open-source engine's usage policy. Pending legal review." },
  title: "Acceptable use policy",
  updated: "Draft of 2026-10-12",
  draftNotice: "Draft, pending legal review. This page is not yet legally binding and will change before launch.",
  intro: "Based on the usage policy of the open-source VoidAccess engine, adapted for the hosted service.",
  sections: [
    { heading: "What the tool is", paragraphs: ["VoidAccess is a passive OSINT platform for collecting and analysing publicly accessible information from dark-web and open-web sources. It does not exploit systems, does not de-anonymise users and does not provide real-time attack capabilities."] },
    { heading: "Who it's for", paragraphs: ["Anyone whose job involves understanding threats so they can defend against them: threat intelligence analysts, SOC teams, penetration testers working within authorised scope, law enforcement and government, and academic researchers."] },
    { heading: "Permitted uses", bullets: [
      "Researching threat actors, malware families and ransomware groups for defensive purposes.",
      "Identifying indicators of compromise to feed into detection systems.",
      "Monitoring sources for mentions of your own organisation, assets, employees or data.",
      "Academic research into cybercrime ecosystems.",
      "Law enforcement investigations with proper authorisation.",
      "Building threat intelligence reports for internal use, or for clients under an authorised engagement.",
    ] },
    { heading: "Prohibited uses", bullets: [
      "Using results to target, harass, extort or dox any individual or organisation.",
      "Running investigations for clients or third parties without documented authorisation.",
      "Locating or accessing illegal content, including anything the content filter blocks, or trying to circumvent the filter.",
      "Feeding results into offensive tooling or attack pipelines.",
      "Reselling access or output without making clear to end users what data is collected and from where.",
      "Using the service where accessing dark-web content is itself illegal, without appropriate authorisation.",
    ] },
    { heading: "Content filtering", paragraphs: ["Mandatory filters block queries, URLs and content relating to child sexual abuse material, gore, snuff content and other illegal or harmful material. They can't be disabled. Attempts to bypass them breach this policy and probably the law. Accounts that trigger them repeatedly may be suspended."] },
    { heading: "Your responsibility", paragraphs: ["You are responsible for complying with the law where you are, for having authorisation before investigating organisations you don't own, and for handling intelligence responsibly. Results may be incomplete or deliberately misleading; verify before acting."] },
    { heading: "Your searches and the archive", paragraphs: ["Your searches and investigations are private, but findings from them are added to a shared, anonymous, dated archive that enriches future searches. Don't submit queries you aren't willing to have contribute findings in this way."] },
    { heading: "Founding seats", paragraphs: ["{{founding.copy}}"], bullets: [
      "The first {{founding.seats}} paid Pro subscribers get {{founding.price}}/mo for {{founding.termMonths}} months from the first payment; it is not a lifetime price.",
      "Each year the seat renews if you paid for at least {{founding.renewalMonths}} of the last {{founding.termMonths}} months. Otherwise it is released and you move to Pro at {{founding.proPrice}}/mo, or Free if you've left.",
      "No investigations for {{founding.inactivityMonths}} consecutive months releases the seat early. We email {{founding.noticeDays}} days before a release and on the day.",
    ] },
    { heading: "Reporting misuse", paragraphs: ["If you see the service or the open-source engine used against this policy, report it through GitHub or the security contact on the Trust page."] },
  ],
};
