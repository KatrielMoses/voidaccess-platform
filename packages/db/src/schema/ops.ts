import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk } from "./_common";
import { users } from "./auth";

/**
 * Lifecycle email ledger (P6): one row per (user, kind), written BEFORE the send so each email goes out at most once.
 * `status` is `sent`, or `suppressed` when the user had turned product email off (recorded too, so turning it on
 * later does not release a stale nudge). System-only: the app role has no grants.
 */
export const lifecycleEmails = pgTable(
  "lifecycle_emails",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // welcome | first_investigation_nudge | what_next
    status: text("status").notNull().default("sent"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("lifecycle_emails_user_kind_uq").on(t.userId, t.kind),
    index("lifecycle_emails_kind_idx").on(t.kind),
  ],
);
