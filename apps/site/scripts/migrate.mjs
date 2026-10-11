// Applies drizzle/*.sql (idempotent) to DATABASE_URL. Local/dev use; production is applied by the architect.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const dir = new URL("../drizzle/", import.meta.url).pathname;
const client = new pg.Client({ connectionString: url });
await client.connect();
for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(dir, f), "utf8").replaceAll("--> statement-breakpoint", "");
  await client.query(sql);
  console.log("applied", f);
}
await client.end();
