import type { PageMeta } from "./types";

export const meta: PageMeta = {
  title: "Join the waitlist: VoidAccess",
  description: "Join the VoidAccess waitlist and claim a founding seat. We'll email you the day the app opens.",
};

export const form = {
  title: "Join the waitlist",
  lead: "Tell us where to send the launch email. Founding seats are first come, first served among paid subscribers, so joining now doesn't reserve one, but it means you hear first.",
  email: "Email",
  role: "What best describes you? (optional)",
  roles: ["Threat intelligence analyst", "SOC / incident response", "Penetration tester or red team", "Security researcher", "Law enforcement or government", "Academic researcher", "Other"],
  useCase: "What would you investigate first? (optional)",
  useCasePlaceholder: "A group, a domain, your own company's name…",
  founding: "I'm interested in a founding seat ({{founding.price}}/mo)",
  consent: "Email me about launch and product updates. I can unsubscribe any time.",
  submit: "Join the waitlist",
  submitting: "Joining…",
  privacy: "We store your email and the answers above. See the privacy page for how first-touch source data is handled.",
  errors: {
    invalid_input: "That doesn't look like a valid email address.",
    captcha_failed: "We couldn't verify you're human. Please try again.",
    rate_limited: "Too many attempts. Please wait a minute and try again.",
    network: "Something went wrong. Please try again.",
  },
};

export const checkEmail = {
  meta: { title: "Check your email: VoidAccess", description: "Confirm your email to finish joining the VoidAccess waitlist." },
  title: "Check your email",
  body: "If that address can join the waitlist, we've sent a confirmation link. Click it to finish. It can take a minute or two; check spam if it doesn't arrive.",
  expired: "That confirmation link isn't valid. Join the waitlist again and we'll send a fresh one.",
  back: "Back to the site",
};

export const confirmed = {
  meta: { title: "You're on the list: VoidAccess", description: "Your email is confirmed for the VoidAccess waitlist." },
  title: "You're on the list",
  body: "Your email is confirmed. We'll write the day the app opens. In the meantime, the engine is open source if you want a look.",
  cta: "See pricing",
};

/** The double opt-in email: plain text, written in the founder's voice. {link} is replaced with the confirm URL. */
export const email = {
  subject: "Confirm your VoidAccess waitlist spot",
  body: `Hi,

Thanks for signing up for the VoidAccess waitlist. One click to confirm it's you:

{link}

If you didn't sign up, ignore this email and nothing happens.

I'll write again when the app opens. Founding price is {{founding.price}}/mo, kept every year you stay active, for the first {{founding.seats}} paying members.

Katriel
Founder, VoidAccess
`,
};
