// H1 hardening tables. All system-only (RLS on, one `system_all` policy, no va_app grants), see migration
// 0007_h1_rate_limits_blocked_domains.
import { bigint, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, tstz } from "./_common";
import { users } from "./auth";

/** Shared auth rate-limit counters (one row per `<ip>|<path>` key), so limits hold across app instances. */
export const rateLimits = pgTable("rate_limits", {
  /** `id` is here because Better Auth's drizzle adapter expects its `rateLimit` model to have one */
  id: pk(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  /** epoch milliseconds of the last counted request (the window is rolling from here) */
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const RATE_LIMIT_SOURCES = ["auth", "run_create"] as const;

/** One row per request that hit a limit. The raw IP is never stored: only a salted hash. Read by P6's abuse queue. */
export const rateLimitEvents = pgTable(
  "rate_limit_events",
  {
    id: pk(),
    /** `auth` (Better Auth path in `path`) or `run_create` (`path` is the cap that was hit) */
    source: text("source").notNull(),
    path: text("path").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    ipHash: text("ip_hash"),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [index("rate_limit_events_at_idx").on(t.at), index("rate_limit_events_user_idx").on(t.userId)],
);

/** Sign-up is refused for these domains and every subdomain of them. Managed by P6's admin UI. */
export const blockedEmailDomains = pgTable("blocked_email_domains", {
  /** lower-case, no leading dot or "@" (e.g. `mailinator.com`) */
  domain: text("domain").primaryKey(),
  reason: text("reason").notNull().default(""),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});
