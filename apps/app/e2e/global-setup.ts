import { execFileSync } from "node:child_process";
import { e2eEnv } from "../playwright.config";

/** Apply migrations to the e2e database as the owner role (idempotent). */
export default function globalSetup() {
  execFileSync("pnpm", ["--filter", "@voidaccess/db", "db:migrate"], {
    env: { ...process.env, MIGRATE_DATABASE_URL: e2eEnv.MIGRATE_DATABASE_URL },
    stdio: "inherit",
  });
}
