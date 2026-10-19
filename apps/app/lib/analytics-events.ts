/**
 * The PRD §7 funnel and where each event is emitted. test/analytics-coverage.test.ts reads this list, checks that
 * every emitter file really contains `trackEvent("<name>"` (or the name as a literal for the billing alert kinds),
 * and fails when an event is missing from the list or has neither an emitter nor an explicit reason.
 */
export interface FunnelEvent {
  name: string;
  /** files (relative to apps/app) that emit it; empty only with `status` other than "emitted" */
  emitters: string[];
  status: "emitted" | "not_yet_applicable" | "out_of_scope";
  note: string;
}

export const FUNNEL_EVENTS: FunnelEvent[] = [
  {
    name: "site_visit",
    emitters: [],
    status: "out_of_scope",
    note: "Belongs to the marketing site (growth rework). The site's beacon was removed in D1.",
  },
  {
    name: "signup_started",
    emitters: ["app/api/auth/[...all]/route.ts"],
    status: "emitted",
    note: "Server-side, when the sign-up request reaches the auth API (utm/ref from the body's first-touch).",
  },
  {
    name: "signup_completed",
    emitters: ["lib/auth/auth.ts"],
    status: "emitted",
    note: "Better Auth user-create hook on the email sign-up path.",
  },
  {
    name: "email_verified",
    emitters: ["lib/auth/auth.ts"],
    status: "emitted",
    note: "Better Auth afterEmailVerification.",
  },
  {
    name: "first_investigation_started",
    emitters: ["lib/runs/service.ts"],
    status: "emitted",
    note: "When a user's first investigation is created.",
  },
  {
    name: "first_investigation_completed",
    emitters: ["lib/runs/complete.ts"],
    status: "emitted",
    note: "When a user's first investigation reaches completed.",
  },
  {
    name: "graph_viewed",
    emitters: ["app/api/investigations/[id]/graph/route.ts"],
    status: "emitted",
    note: "First load of an investigation's graph data (the graph view's fetch), once per investigation.",
  },
  {
    name: "export_used",
    emitters: ["app/api/investigations/[id]/exports/[format]/route.ts"],
    status: "emitted",
    note: "Each successful export download, with the format.",
  },
  {
    name: "credits_80",
    emitters: ["lib/billing/alerts.ts"],
    status: "emitted",
    note: "When 80% of the monthly credits are used, once per period (the alert kind is the event name).",
  },
  {
    name: "upgrade_viewed",
    emitters: ["app/(app)/billing/page.tsx"],
    status: "emitted",
    note: "Billing page view by a user not on the top plan.",
  },
  {
    name: "subscribed",
    emitters: ["lib/billing/post-effects.ts"],
    status: "emitted",
    note: "Creem webhook, after the subscription commits (plan in props).",
  },
  {
    name: "topup_purchased",
    emitters: ["lib/billing/post-effects.ts"],
    status: "emitted",
    note: "Creem webhook, after the top-up commits (usd in props).",
  },
  {
    name: "monitor_created",
    emitters: [],
    status: "not_yet_applicable",
    note: "Defined (trackMonitorCreated in lib/analytics.ts); monitors ship in a later brief, so nothing calls it yet.",
  },
  {
    name: "cancelled",
    emitters: ["lib/billing/plan-ops.ts"],
    status: "emitted",
    note: "Cancel-at-period-end (reason in props).",
  },
];
