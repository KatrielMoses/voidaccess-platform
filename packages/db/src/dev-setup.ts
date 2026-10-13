// Local development bootstrap: migrate, give va_app and va_worker dev passwords (and the dev context key), seed.
//   MIGRATE_DATABASE_URL=postgres:///voidaccess_dev pnpm --filter @voidaccess/db db:setup-dev
// Refuses to run against non-local hosts.
import pg from "pg";
import { runMigrations } from "./migrate";
import { createLocalDatabase, prepareLocalRoles, LOCAL_APP_PASSWORD, withLogin } from "./local";
import { seed } from "./seed";

const owner = new URL(process.env.MIGRATE_DATABASE_URL ?? "postgres://localhost/voidaccess_dev");
if (!["localhost", "127.0.0.1", ""].includes(owner.hostname))
  throw new Error("dev-setup only runs against a local database");

await runMigrations(owner.toString());
const client = new pg.Client({ connectionString: owner.toString() });
await client.connect();
await prepareLocalRoles(client);
await client.end();
const app = new URL(withLogin(owner.toString(), "va_app", LOCAL_APP_PASSWORD));
const database = createLocalDatabase(app.toString());
const res = await seed(database);
await database.close();
console.log(
  `seeded ${res.length} users. App connection: DATABASE_URL=${app.toString()}\n` +
    `System connection: DATABASE_URL_SYSTEM=${withLogin(app.toString(), "va_worker", process.env.VA_WORKER_LOCAL_PASSWORD ?? "va_worker_local")}`,
);
