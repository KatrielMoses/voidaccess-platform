/**
 * First-party analytics: inserts into `events` through withSystem('analytics.event'). Nothing leaves our database, no
 * third-party tracker is involved, and no IP address or user agent is ever passed in or stored.
 * Never throws (analytics must not break a user flow); returns false when the write failed.
 * Attaches first-touch attribution (utm/ref) from users.first_touch when a userId is given.
 * The PRD §7 funnel and where each event fires is listed in lib/analytics-events.ts (a test keeps it honest).
 */
import { eq } from "drizzle-orm";
import { events, getDatabase, users, type FirstTouch } from "@voidaccess/db";

export type AnalyticsEventName =
  | "signup_started"
  | "signup_completed"
  | "email_verified"
  | "first_investigation_started"
  | "first_investigation_completed"
  | "graph_viewed"
  | "export_used"
  | "credits_80"
  | "upgrade_viewed"
  | "subscribed"
  | "topup_purchased"
  | "monitor_created"
  | "cancelled"
  | (string & {});

export async function trackEvent(
  name: AnalyticsEventName,
  opts: {
    userId?: string | null;
    anonymousId?: string | null;
    props?: Record<string, unknown>;
    /** attribution known before there is a user (signup_started); a user's stored first touch wins when present */
    firstTouch?: FirstTouch | null;
    /** record the event at most once per (name, user, key): e.g. graph_viewed per investigation */
    dedupeKey?: string;
  } = {},
): Promise<boolean> {
  try {
    await getDatabase().withSystem(
      "analytics.event",
      async (tx) => {
        let utm: Record<string, string> | null = opts.firstTouch?.utm ?? null;
        let ref: string | null = opts.firstTouch?.ref ?? null;
        if (opts.userId) {
          const [u] = await tx
            .select({ firstTouch: users.firstTouch })
            .from(users)
            .where(eq(users.id, opts.userId));
          utm = u?.firstTouch?.utm ?? utm;
          ref = u?.firstTouch?.ref ?? ref;
        }
        await tx
          .insert(events)
          .values({
            name,
            userId: opts.userId ?? null,
            anonymousId: opts.anonymousId ?? null,
            props: opts.dedupeKey ? { ...opts.props, dedupeKey: opts.dedupeKey } : (opts.props ?? {}),
            utm,
            ref,
          })
          // events_dedupe_uq (migration 0006) only indexes rows that carry props.dedupeKey
          .onConflictDoNothing();
      },
      { audit: false },
    );
    return true;
  } catch (e) {
    console.error("analytics: trackEvent failed", name, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Defined for the funnel; nothing calls it yet because monitors ship later (see lib/analytics-events.ts). */
export const trackMonitorCreated = (userId: string, props: { monitorId: string; cadence?: string }) =>
  trackEvent("monitor_created", { userId, props, dedupeKey: props.monitorId });
