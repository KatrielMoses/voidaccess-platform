import type { Faq, PageMeta } from "./types";

export const meta: PageMeta = {
  title: "Pricing: VoidAccess",
  description:
    "Free to start, no card. Pay for credits, not seats: a Standard investigation costs {{depth.standard}} credits. Pro from {{founding.price}}/mo at the founding price for the first {{founding.seats}} subscribers.",
};

export const hero = {
  title: "Pay for investigations, not seats",
  sub: "Every plan includes monthly credits. A Quick investigation costs {{depth.quick}} credits, a Standard one {{depth.standard}}. Failed or cancelled runs are refunded automatically.",
};

export const billing = { monthly: "Monthly", annual: "Annual", annualNote: "{{pro.monthsFree}} months free" };

/** Human labels for the feature keys in @voidaccess/config. `soon: true` marks features that ship after launch. */
export const featureLabels: Record<string, { label: string; soon?: boolean }> = {
  export_core: { label: "CSV and JSON export" },
  export_all: { label: "All exports: STIX 2.1, MISP, IOC package, and detection rules where available" },
  history_unlimited: { label: "Unlimited history" },
  share_links: { label: "Share links", soon: true },
  monitors: { label: "Monitors and alerts", soon: true },
  actor_library: { label: "Cross-investigation actor library", soon: true },
  byo_keys: { label: "Bring your own API keys", soon: true },
  priority_queue: { label: "Priority queue", soon: true },
};

/** `lead` lines open each card's list (credits first); `extras` follow, then the plan's features from config. */
export const planCopy = {
  free: {
    tagline: "Try it on a real question.",
    cta: "Start free",
    lead: ["{{free.credits}} credits a month, about {{free.quickRuns}} Quick or {{free.standardRuns}} Standard investigations", "No card"],
    extras: ["Quick and Standard investigations", "{{free.historyDays}}-day history"],
  },
  pro: {
    tagline: "For regular investigations.",
    cta: "Choose Pro",
    lead: ["{{pro.credits}} credits a month, about {{pro.standardRuns}} Standard investigations"],
    extras: ["Quick and Standard investigations", "Deep investigations are not available at launch"],
  },
  pro_plus: {
    tagline: "For analysts who live in it.",
    cta: "Choose Pro+",
    lead: ["{{plus.credits}} credits a month, about {{plus.standardRuns}} Standard investigations"],
    extras: ["Everything in Pro"],
  },
  /** Pro+ lists its unreleased features in their own group, under this heading. */
  roadmapHeading: "On the roadmap (Pro+ gets them first)",
  regularPrice: "Regular price",
  foundingPriceLabel: "founding price",
  foundingNote: "{{founding.price}}/mo founding price, first {{founding.seats}} subscribers",
  soonNote: "Coming after launch",
  proBadge: "Founding seats open",
  perMonth: "/mo",
  perYear: "/yr billed annually",
};

export const explainer = {
  heading: "How credits work",
  body: "A credit is the unit you spend on investigations. Viewing results, the graph and exports cost nothing.",
  rows: [
    { name: "Quick investigation", credits: "{{depth.quick}}", note: "A faster, lighter pass." },
    { name: "Standard investigation", credits: "{{depth.standard}}", note: "The default depth." },
  ],
  example: "That's about {{pro.standardRuns}} Standard investigations a month on Pro, or {{pro.quickRuns}} Quick ones.",
  rules: ["Subscription credits reset each month and do not roll over.", "Top-up credits are used after your monthly credits and expire {{topup.expiryMonths}} months after purchase."],
};

export const topups = {
  heading: "Top-ups",
  body: "Need more in a month? Buy credits any time, on any plan, including Free. Bigger top-ups and subscribers get extra credits.",
  /** The rule, one cell each: `value` is a token, `label` says what it is. */
  rule: [
    { value: "{{topup.min}}", label: "Minimum top-up" },
    { value: "{{topup.max}}", label: "Maximum top-up" },
    { value: "{{topup.rate}}", label: "Credits per dollar" },
    { value: "{{topup.expiryMonths}}", label: "Months before they expire" },
  ],
  volume: {
    heading: "Volume bonus",
    note: "Bigger top-ups get extra credits. The highest tier you reach applies.",
    from: "From",
  },
  subscriber: {
    heading: "Subscriber bonus",
    note: "Added on top of the volume bonus.",
    rows: [
      { plan: "Pro", bonus: "+{{topup.proBonus}}" },
      { plan: "Pro+", bonus: "+{{topup.plusBonus}}" },
    ],
  },
  example: {
    heading: "Worked examples",
    body: "{{topup.example.usd}} on Pro: {{topup.example.base}} credits, plus the {{topup.example.volumePct}} volume bonus makes {{topup.example.withVolume}}, plus the {{topup.example.subscriberPct}} Pro bonus makes {{topup.example.credits}}.",
    columns: { pay: "You pay", bonus: "Volume bonus", free: "Free", pro: "Pro", plus: "Pro+" },
    caption: "Credits you get for a top-up, by plan",
  },
  minimum: "Any whole-dollar amount from {{topup.min}} to {{topup.max}}.",
};

export const founding = {
  badge: "Founding seats",
  title: "Founding price {{founding.price}}/mo",
  lead: "Founding seats: {{founding.price}}/mo for the first {{founding.seats}} Pro subscribers. Your price renews every year you stay active. Monthly billing only.",
  rulesSummary: "Full rules",
  counterLabel: "seats available",
  counterOf: "of",
  counterLoading: "checking seats…",
  cta: "Claim a founding seat",
  rulesHeading: "The rules, plainly",
  rules: [
    "The first {{founding.seats}} paid Pro subscribers get Pro at {{founding.price}}/mo, with the same {{founding.credits}} credits a month, and a Founding member badge.",
    "The price is held for {{founding.termMonths}} months from your first payment. It is not locked for life.",
    "Each year we check your seat: if you paid for at least {{founding.renewalMonths}} of the last {{founding.termMonths}} months, it renews at {{founding.price}} for another {{founding.termMonths}} months. If not, the seat is released and you move to Pro at {{founding.proPrice}}/mo (or Free if you've left).",
    "If you run no investigations for {{founding.inactivityMonths}} months in a row, the seat is released early with the same outcome.",
    "We email you {{founding.noticeDays}} days before a release and again on the day.",
    "Released seats go back to the pool for the next new subscriber.",
    "Founding seats are monthly billing only. Upgrading to Pro+ gives up the founding price; we warn you before you confirm.",
  ],
};

export const faq: Faq[] = [
  { q: "What is a credit?", a: "A credit is what an investigation costs. A Quick investigation is {{depth.quick}} credits and a Standard one is {{depth.standard}}. Viewing results, the graph, and exports cost nothing." },
  { q: "Do unused credits roll over?", a: "No. Subscription credits reset every month. Top-up credits are different: they're spent after your monthly credits and last {{topup.expiryMonths}} months." },
  { q: "How much can I top up?", a: "Any whole-dollar amount from {{topup.min}} to {{topup.max}}, at {{topup.rate}} credits per dollar. Bigger top-ups get a volume bonus ({{topup.volume}}), and subscribers get a further bonus on top: +{{topup.proBonus}} on Pro, +{{topup.plusBonus}} on Pro+." },
  { q: "Do top-up credits expire?", a: "Yes, {{topup.expiryMonths}} months after purchase. They're spent after your monthly credits." },
  { q: "Can I cancel any time?", a: "Yes. Cancel from your account; you keep your plan until the end of the period you've paid for." },
  { q: "What if a run fails?", a: "Failed and cancelled runs are refunded automatically in credits. You never pay for an investigation that didn't complete." },
  { q: "What does annual billing save?", a: "Annual billing gives {{pro.monthsFree}} months free: Pro is {{pro.annual}} a year and Pro+ is {{plus.annual}} a year. Founding seats are monthly only." },
  { q: "How do the founding seats work?", a: "{{founding.copy}} The first {{founding.seats}} paid Pro subscribers get {{founding.price}}/mo for {{founding.termMonths}} months, renewed each year you stay active. The full rules are on this page." },
  { q: "How do I pay?", a: "By card at checkout. Payments are processed by Creem, our merchant of record, which adds any applicable tax and emails your receipt. Cancel any time from Billing in the app." },
  { q: "Can I get a refund?", a: "Yes. Email {{support.email}} within 14 days of a payment and we'll refund it in full, as long as you haven't used the credits it bought." },
];
