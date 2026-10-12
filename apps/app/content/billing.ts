/**
 * Billing copy, kept apart from code so the growth architect can rewrite it. Tokens in {braces} are filled
 * from @voidaccess/config by the page or job that renders the text; no price or credit number is typed here.
 */
export const billingCopy = {
  title: "Plans and credits",
  intro: "Pay for investigations, not seats. Credits reset monthly; top-ups last {expiryMonths} months.",
  currentPlan: "Current plan",
  monthly: "Monthly",
  annual: "Annual",
  annualNote: "{monthsFree} months free",
  perMonth: "/mo",
  perYear: "/yr",
  creditsLine: "{credits} credits every month",
  features: {
    export_core: "CSV and JSON export",
    export_all: "All exports: STIX, MISP, IOC package and detection rules",
    history_unlimited: "Unlimited history",
    share_links: "Share links (coming after launch)",
    deep: "Deep investigations (when they launch)",
    monitors: "Monitors and alerts (coming after launch)",
    actor_library: "Cross-investigation actor library (coming after launch)",
    byo_keys: "Bring your own API keys (coming after launch)",
    priority_queue: "Priority queue",
  } as Record<string, string>,
  historyDays: "{days}-day history",
  noCard: "No card required",
  checkout: {
    subscribe: "Subscribe to {plan}",
    notice:
      "You'll pay {price} {per} on Dodo's secure checkout. Cancel any time; it takes effect at the end of the period you've paid for.",
    foundingTitle: "Founding seat",
    foundingCta: "Claim a founding seat",
    foundingNotice: "You'll pay {price} per month on Dodo's secure checkout. {line}",
  },
  founding: {
    heading: "Founding price {price}/mo",
    line: "{foundingLine}",
    counter: "{available} of {total} seats available",
    soldOut: "All founding seats are taken right now. Seats that are released go back to the pool.",
    rulesHeading: "The rules, plainly",
    rules: [
      "The first {seats} paid Pro subscribers get {price}/mo, with the same {credits} credits a month as Pro, and a Founding member badge.",
      "The price is held for {termMonths} months from your first payment. It is not locked for life.",
      "Each year we check your seat: paid for at least {renewalMonths} of the last {termMonths} months, and it renews for another {termMonths} months. Otherwise it is released and you move to Pro at {proPrice}/mo (or Free if you've left).",
      "No investigations for {inactivityMonths} months in a row releases the seat early, with the same outcome.",
      "We email you {noticeDays} days before a release and again on the day. Plan changes always happen at a renewal, never mid-period.",
      "Founding seats are monthly billing only. Moving to Pro+ or to annual billing gives the seat up; we warn you first.",
    ],
    yourSeat: "Your founding seat",
    termEnds: "Current term ends",
    status: { renews: "Renews if you stay active", at_risk: "At risk: see your email for what to do" },
  },
  topups: {
    heading: "Top-ups",
    body: "Need more this month? Buy credits any time, on any plan. Subscribers get a bonus.",
    columns: { pay: "You pay", credits: "You get", bonus: "Your bonus" },
    buy: "Buy {usd}",
    expiry:
      "Top-up credits are used after your monthly credits and expire {expiryMonths} months after purchase.",
  },
  subscription: {
    heading: "Your subscription",
    renews: "Renews on {date}",
    endsOn: "Ends on {date}. You keep everything until then.",
    cancel: "Cancel subscription",
    cancelHelp: "Takes effect at the end of the period you've paid for.",
    cancelReason: "What made you leave? (optional)",
    resume: "Keep my subscription",
    portal: "Manage billing",
    portalHelp: "Update your card and download invoices and receipts (handled by Dodo Payments).",
    pendingDowngrade: "Your plan changes to {plan} on {date}.",
    pastDue: "Your last payment failed. Update your payment method to keep your plan.",
  },
  change: {
    upgradeTitle: "Upgrade to {plan}",
    upgradeBody:
      "Dodo will charge {amount} now for the rest of this period (prorated). You get the extra credits straight away.",
    downgradeTitle: "Switch to {plan}",
    downgradeBody:
      "Your plan changes on {date}, the end of the period you've paid for. Until then nothing changes.",
    foundingWarning:
      "Heads up: this gives up your founding seat ({price}/mo). The seat goes back to the pool and can't be reclaimed if it's taken.",
    confirm: "Confirm",
    working: "Working…",
  },
  alerts: {
    b80: "You've used {pct}% of this month's credits.",
    b100: "You've used all of this month's credits. Credits reset on {date}.",
    topUp: "Top up",
    upgrade: "Upgrade",
    dismiss: "Dismiss",
    pastDue: "Your last payment failed.",
    updatePayment: "Update payment method",
  },
  outOfCredits: {
    title: "Not enough credits",
    body: "This needs {needed} credits and you have {balance}.",
    cheapest: "Top up {usd} to continue",
    upgrade: "Or upgrade for more every month",
  },
  usage: {
    title: "Usage",
    balance: "Balance",
    grantBucket: "Monthly credits",
    resets: "Resets {date}",
    topupBucket: "Top-up credits",
    expires: "Expires {date}",
    none: "No top-up credits.",
    filters: { all: "All activity", month: "Month" },
    columns: {
      date: "Date",
      action: "Action",
      investigation: "Investigation",
      amount: "Amount",
      bucket: "Bucket",
      balance: "Balance after",
    },
    empty: "No credit activity for these filters.",
    download: "Download CSV",
    older: "Older",
    newer: "Newer",
  },
  notices: {
    renewalReason:
      "Your seat renews on {date} only if you've paid for at least {renewalMonths} of the last {termMonths} months. We count {paidMonths} so far.",
    inactivityReason:
      "You haven't run an investigation recently, and seats are released after {inactivityMonths} months without one.",
    keepRenewal: "To keep it, stay subscribed: every paid month counts.",
    keepInactivity: "Run an investigation before {date} to keep it.",
    releasedRenewal: "You paid for fewer than {renewalMonths} of the last {termMonths} months.",
    releasedInactivity: "There were no investigations for {inactivityMonths} months.",
    nextPro: "You stay subscribed and move to Pro at {proPrice}/mo at your next renewal ({date}).",
    nextFree: "You're now on the Free plan.",
    nextPlanPro: "Pro at {proPrice}/mo",
    nextPlanFree: "Free",
  },
} as const;

export const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
