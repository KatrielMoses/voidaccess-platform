import type { LegalPage } from "./types";

export const page: LegalPage = {
  meta: { title: "Privacy policy (draft): VoidAccess", description: "Draft privacy policy for the VoidAccess website and waitlist, pending legal review." },
  title: "Privacy policy",
  updated: "Draft of 2026-10-12",
  draftNotice: "Draft, pending legal review. This page is not yet legally binding and will change before launch.",
  intro: "This draft covers the marketing site and waitlist. It will be extended for the app before launch.",
  sections: [
    { heading: "What we collect on the waitlist", bullets: [
      "Your email address, and optionally your role, what you'd investigate first, and whether you want a founding seat.",
      "Whether you agreed to launch and product emails.",
      "A salted, one-way hash of your IP address, used only to limit abuse. We don't store your IP address.",
      "First-touch source data: where you first came from (utm parameters, a ref code, the referring site, the page you landed on, and the time).",
    ] },
    { heading: "Analytics", paragraphs: [
      "We use Plausible, a privacy-friendly analytics service. It sets no cookies and doesn't track you across sites. The script is served from our own domain. We record two custom events: a visit with its source (utm parameters and ref) and a waitlist signup.",
    ] },
    { heading: "First-touch attribution storage", paragraphs: [
      "To tell which campaign brought you here, we keep your first-touch source in your browser's local storage (first-party, on this site only). We ask before saving it. If you decline, the source is only held in memory while you browse and is sent with the waitlist form if you submit it. Nothing is shared with third parties.",
    ] },
    { heading: "Why we use it", paragraphs: ["To send the confirmation and launch emails you asked for, to keep the waitlist free of abuse, and to learn which channels work. Our basis is your consent (emails, attribution storage) and our legitimate interest in preventing abuse."] },
    { heading: "Email and processors", paragraphs: ["We use Resend to send email, Cloudflare to host the site and for bot protection (Turnstile), Neon for the database, and Plausible for analytics. Each handles data only on our behalf."] },
    { heading: "Retention and your rights", paragraphs: ["We keep waitlist data until you ask us to delete it or the waitlist closes. You can ask to see, correct or delete your data, or withdraw consent, at any time: [contact address to be set by counsel]."] },
    { heading: "The app and the archive", paragraphs: [
      "When the app launches this policy will cover accounts and investigations. Your searches and investigations will be private to your account. Findings from them go into a shared, anonymous, dated archive that holds no user identity and no query text, and is permanent. Investigations are deleted with your account.",
      "Founding-seat data we will keep per founding member: seat start date, anniversary date, paid months in the trailing {{founding.termMonths}}, and the date of your last investigation, so we can apply the founding rules ({{founding.copy}}).",
    ] },
  ],
};
