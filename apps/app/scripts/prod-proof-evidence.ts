// Production proof helper: prints a test account's ledger rows and run_costs for the evidence report (read-only).
//   DATABASE_URL=<va_app url> tsx scripts/prod-proof-evidence.ts delivered+d1proof-xxxx@resend.dev
import { asc, eq } from "drizzle-orm";
import { getDatabase } from "@voidaccess/db";
import { creditLedger, investigations, runCosts, users } from "@voidaccess/db/schema";

const email = process.argv[2] ?? "";
if (!/^delivered\+d1proof[a-z0-9-]*@resend\.dev$/.test(email)) throw new Error("not a d1proof test address");
const out = await getDatabase().withSystem(
  "ops.proof-evidence",
  async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.email, email));
    if (!u) return { user: null };
    const ledger = await tx
      .select({ amount: creditLedger.amount, reason: creditLedger.reason, at: creditLedger.createdAt })
      .from(creditLedger)
      .where(eq(creditLedger.userId, u.id))
      .orderBy(asc(creditLedger.createdAt));
    const costs = await tx
      .select()
      .from(runCosts)
      .innerJoin(investigations, eq(investigations.id, runCosts.investigationId))
      .where(eq(investigations.userId, u.id));
    return {
      user: { id: u.id, plan: u.plan, emailVerified: u.emailVerified, aupAcceptedAt: u.aupAcceptedAt },
      ledger,
      runs: costs.map((c) => ({
        investigationId: c.investigations.id,
        status: c.investigations.status,
        runCosts: c.run_costs,
      })),
    };
  },
  { audit: false },
);
console.log(JSON.stringify(out, null, 2));
process.exit(0);
