// PLACEHOLDER (P6). H1 owns `blocked_email_domains` and enforces it at sign-up; P6 only builds the admin UI on top.
// This mirrors the shape in H1's brief (domain, reason, created_by, created_at) so P6 can be built and tested alone.
// The architect drops this file, its export line and migration `pending_h1_blocked_email_domains` at merge in favour of H1's.
import { pgTable, text } from "drizzle-orm/pg-core";
import { createdAt } from "./_common";

export const blockedEmailDomains = pgTable("blocked_email_domains", {
  domain: text("domain").primaryKey(),
  reason: text("reason").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});
