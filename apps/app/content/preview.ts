/**
 * Preview and unlock copy (Free shows a preview, Pro unlocks the full report). Kept apart from code so it can be
 * rewritten without touching components. {counts}, {price} and {email} are filled by the component; prices come
 * from @voidaccess/config, the address from lib/site.ts.
 */
export const previewCopy = {
  /** The one-line disclosure shown before any run (signup, first-run screen, new investigation, pricing, billing). */
  disclosure: "Free runs show a preview. Pro unlocks full reports.",
  panel: {
    ready: "Your full report is ready. {counts} found.",
    readyNoCounts: "Your full report is ready.",
    why: "We wanted VoidAccess to be free. The free tier got abused with throwaway accounts, so full reports are now for Pro.",
    price: "Pro is {price} a month, about the price of a coffee. Cancel anytime.",
    cta: "Unlock this report: {price}/mo",
    plans: "See plans",
    fallback: "Card not going through? Email {email} and we'll send another way to pay.",
  },
  locked: {
    detail: "Entity details are part of the full report.",
    exportState: "Locked · unlock the full report",
    exportsNote: "Exports are part of the full report: unlock it to download any format.",
    graph: "Labels and details are part of the full report.",
    rows: "{shown} of {total} shown",
  },
  unlocking: {
    title: "Unlocking…",
    body: "Payment received. Your report unlocks as soon as Creem confirms it, usually within a few seconds.",
    slow: "This is taking longer than usual. Refresh the page in a minute, or email {email} and we'll sort it out.",
    done: "Unlocked. Loading your full report…",
  },
  failed: {
    title: "The payment didn't go through",
    body: "No charge was made and your report is still here.",
  },
  errors: {
    generic: "We couldn't start the checkout. Try again, or email {email}.",
    alreadySubscribed: "You already have a subscription. Manage it in Billing.",
  },
} as const;

export const fillPreview = (s: string, vars: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
