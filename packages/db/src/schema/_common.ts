import { sql } from "drizzle-orm";
import { pgEnum, timestamp, uuid } from "drizzle-orm/pg-core";
import { PLANS, type PlanId } from "@voidaccess/config";

export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
export const createdAt = () => tstz("created_at").notNull().defaultNow();
export const pk = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);

/** Plan ids come from config so the enum can never drift from pricing.ts. */
export const planEnum = pgEnum("plan", Object.keys(PLANS) as [PlanId, ...PlanId[]]);
export const depthEnum = pgEnum("depth", ["quick", "standard", "deep"]);
