import { execFileSync } from "node:child_process";
import { prepareLocalRolesAt } from "@voidaccess/db/local";
import { e2eEnv } from "../playwright.config";

/** Apply migrations to the e2e database as the owner role (idempotent), then give the logins their local passwords and key. */
export default async function globalSetup() {
  execFileSync("pnpm", ["--filter", "@voidaccess/db", "db:migrate"], {
    env: { ...process.env, MIGRATE_DATABASE_URL: e2eEnv.MIGRATE_DATABASE_URL },
    stdio: "inherit",
  });
  await prepareLocalRolesAt(e2eEnv.MIGRATE_DATABASE_URL);
}
