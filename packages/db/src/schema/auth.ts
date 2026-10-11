// Better Auth core tables (generated with the Better Auth CLI for the Drizzle adapter, usePlural),
// then adapted: uuid ids with DB defaults, timestamptz, platform columns on `users`.
// Auth flows themselves are P2. NOTE for P2: Better Auth looks sessions up before a user is known,
// so its adapter must run on the system role (withSystem), never under withUser.
import { relations } from "drizzle-orm";
import { boolean, index, jsonb, pgEnum, text, uuid, pgTable } from "drizzle-orm/pg-core";
import { createdAt, pk, planEnum, tstz } from "./_common";

export const userStatusEnum = pgEnum("user_status", ["active", "suspended", "banned"]);
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

export type FirstTouch = { utm?: Record<string, string>; ref?: string; landing?: string; at?: string };

export const users = pgTable("users", {
  id: pk(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: tstz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  // platform columns
  aupAcceptedAt: tstz("aup_accepted_at"),
  plan: planEnum("plan").notNull().default("free"),
  status: userStatusEnum("status").notNull().default("active"),
  role: userRoleEnum("role").notNull().default("user"),
  profileRole: text("profile_role"),
  profileUseCase: text("profile_use_case"),
  firstTouch: jsonb("first_touch").$type<FirstTouch>(),
  referralCode: text("referral_code").unique(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: pk(),
    expiresAt: tstz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: tstz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: pk(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: tstz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: pk(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: tstz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
}));
export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));
export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));
