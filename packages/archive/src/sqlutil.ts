import { sql } from "drizzle-orm";

/** A Postgres array literal built from bound parameters (drizzle spreads a bare JS array into a record, not an array). */
export function arr(values: readonly string[], type: "uuid" | "text") {
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::${sql.raw(type)}[]`;
}
