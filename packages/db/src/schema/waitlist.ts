import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Pre-launch waitlist / founding-seat interest. Owned by lane SITE (P1).
 * Emails are stored lower-cased; the unique index is on lower(email) as a second guard.
 * IPs are never stored raw: ip_hash is an HMAC-SHA256 with a server-side salt.
 */
export interface FirstTouch {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  ref?: string;
  referrer?: string;
  landing_path?: string;
  ts?: string;
}

export const waitlist = pgTable(
  "waitlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    role: text("role"),
    useCase: text("use_case"),
    wantsFounding: boolean("wants_founding").notNull().default(false),
    firstTouch: jsonb("first_touch").$type<FirstTouch>().notNull().default(sql`'{}'::jsonb`),
    refCode: text("ref_code"),
    ipHash: text("ip_hash").notNull(),
    consentMarketing: boolean("consent_marketing").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmTokenHash: text("confirm_token_hash"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("waitlist_email_lower_uq").on(sql`lower(${t.email})`),
    uniqueIndex("waitlist_confirm_token_hash_uq").on(t.confirmTokenHash),
  ],
);

export type WaitlistRow = typeof waitlist.$inferSelect;
export type NewWaitlistRow = typeof waitlist.$inferInsert;
