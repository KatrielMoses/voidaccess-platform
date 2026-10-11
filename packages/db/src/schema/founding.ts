import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, tstz } from "./_common";
import { users } from "./auth";

export const FOUNDING_RELEASE_REASONS = ["renewal_failed", "inactivity", "upgraded", "admin", "account_closed"] as const;

/**
 * Exactly 100 rows (seat_no 1..100) are inserted by the migration. A seat is "held" when
 * holder_user_id IS NOT NULL. Capacity is therefore a DB guarantee: PK range + unique holder,
 * claims are a single UPDATE ... FOR UPDATE SKIP LOCKED, never check-then-insert.
 */
export const foundingSeats = pgTable(
  "founding_seats",
  {
    seatNo: integer("seat_no").primaryKey(),
    holderUserId: uuid("holder_user_id")
      .unique()
      .references(() => users.id, { onDelete: "set null" }),
    /** who held it last (kept after release for history and notices) */
    lastHolderUserId: uuid("last_holder_user_id").references(() => users.id, { onDelete: "set null" }),
    claimedAt: tstz("claimed_at"),
    termStart: tstz("term_start"),
    anniversaryAt: tstz("anniversary_at"),
    releasedAt: tstz("released_at"),
    releaseReason: text("release_reason"),
  },
  (t) => [check("founding_seats_seat_no_range", sql`${t.seatNo} between 1 and 100`)],
);

export const foundingNoticeKindEnum = pgEnum("founding_notice_kind", [
  "renewal_check_30d",
  "inactivity_30d",
  "release_day",
]);

/** Scheduled by runFoundingChecks; the emails lane sends rows where sent_at IS NULL and scheduled_for <= now. */
export const foundingNotices = pgTable(
  "founding_notices",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seatNo: integer("seat_no").notNull(),
    kind: foundingNoticeKindEnum("kind").notNull(),
    /** the date this notice is about (release date or anniversary) — part of the dedupe key */
    refAt: tstz("ref_at").notNull(),
    scheduledFor: tstz("scheduled_for").notNull(),
    sentAt: tstz("sent_at"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("founding_notices_dedupe_uq").on(t.userId, t.kind, t.refAt),
    index("founding_notices_due_idx").on(t.scheduledFor).where(sql`${t.sentAt} IS NULL`),
  ],
);
