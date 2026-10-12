// Production proof helper: marks ONE throwaway test account's email as verified (no inbox is reachable for it).
//   DATABASE_URL=<va_app url> tsx scripts/ops-verify-test-account.ts delivered+d1proof-xxxx@resend.dev
// Refuses anything that is not a Resend test address with the d1proof tag, so it cannot touch a real account.
import { eq } from "drizzle-orm";
import { getDatabase } from "@voidaccess/db";
import { users } from "@voidaccess/db/schema";

const email = process.argv[2] ?? "";
if (!/^delivered\+d1proof[a-z0-9-]*@resend\.dev$/.test(email)) throw new Error("not a d1proof test address");
const rows = await getDatabase().withSystem("ops.verify-test-account", (tx) =>
  tx.update(users).set({ emailVerified: true }).where(eq(users.email, email)).returning({ id: users.id }),
);
console.log(JSON.stringify({ verified: rows.length }));
process.exit(rows.length === 1 ? 0 : 1);
