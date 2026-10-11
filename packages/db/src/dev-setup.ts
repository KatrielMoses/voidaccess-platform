// Local development bootstrap: migrate, give va_app a dev password, seed.
//   MIGRATE_DATABASE_URL=postgres:///voidaccess_dev pnpm --filter @voidaccess/db db:setup-dev
// Refuses to run against non-local hosts.
import pg from "pg";
import { runMigrations } from "./migrate";
import { createDatabase } from "./client";
import { seed } from "./seed";

const owner = new URL(process.env.MIGRATE_DATABASE_URL ?? "postgres://localhost/voidaccess_dev");
if (!["localhost", "127.0.0.1", ""].includes(owner.hostname))
  throw new Error("dev-setup only runs against a local database");
// va_app is a cluster-wide role: dev-setup and tests must agree on its local password.
const DEV_PASSWORD = process.env.VA_APP_LOCAL_PASSWORD ?? "va_app_local";

await runMigrations(owner.toString());
const client = new pg.Client({ connectionString: owner.toString() });
await client.connect();
await client.query(`ALTER ROLE va_app LOGIN PASSWORD '${DEV_PASSWORD}'`);
await client.end();
const app = new URL(owner.toString());
app.username = "va_app";
app.password = DEV_PASSWORD;
const database = createDatabase(app.toString());
const res = await seed(database);
await database.close();
console.log(`seeded ${res.length} users. App connection: DATABASE_URL=${app.toString()}`);
