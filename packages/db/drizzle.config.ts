import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres:///voidaccess_dev" },
});
