import { defineConfig } from "drizzle-kit";

// Generates the waitlist migration only. The architect merges the resulting SQL
// alongside P0's migrations (see drizzle/README.md).
export default defineConfig({
  dialect: "postgresql",
  schema: "../../packages/db/src/schema/waitlist.ts",
  out: "./drizzle",
});
