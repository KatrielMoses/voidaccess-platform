/**
 * First-party analytics: inserts into `events` through withSystem('analytics.event').
 * Never throws (analytics must not break a user flow); returns false when the write failed.
 * Attaches first-touch attribution (utm/ref) from users.first_touch when a userId is given.
 */
import { eq } from "drizzle-orm";
import { events, getDatabase, users } from "@voidaccess/db";

export type AnalyticsEventName =
  | "signup_started"
  | "signup_completed"
  | "email_verified"
  | "first_investigation_started"
  | "first_investigation_completed"
  | (string & {});

export async function trackEvent(
  name: AnalyticsEventName,
  opts: { userId?: string | null; anonymousId?: string | null; props?: Record<string, unknown> } = {},
): Promise<boolean> {
  try {
    await getDatabase().withSystem(
      "analytics.event",
      async (tx) => {
        let utm: Record<string, string> | null = null;
        let ref: string | null = null;
        if (opts.userId) {
          const [u] = await tx
            .select({ firstTouch: users.firstTouch })
            .from(users)
            .where(eq(users.id, opts.userId));
          utm = u?.firstTouch?.utm ?? null;
          ref = u?.firstTouch?.ref ?? null;
        }
        await tx.insert(events).values({
          name,
          userId: opts.userId ?? null,
          anonymousId: opts.anonymousId ?? null,
          props: opts.props ?? {},
          utm,
          ref,
        });
      },
      { audit: false },
    );
    return true;
  } catch (e) {
    console.error("analytics: trackEvent failed", name, e instanceof Error ? e.message : e);
    return false;
  }
}
