// Production proof helper: creates ONE throwaway, verified account server-side, because Turnstile (correctly) keeps
// automated browsers off the real sign-up form. It goes through Better Auth's own sign-up (AUP stored, free grant,
// referral code via the same hooks); only the captcha, which guards the HTTP endpoint, is not in play.
//   DATABASE_URL=<va_app url> tsx scripts/ops-create-test-account.ts delivered+d1proof-xxxx@resend.dev <password>
// Refuses anything that is not a Resend test address with the d1proof tag.
import { eq } from "drizzle-orm";
import { getDatabase } from "@voidaccess/db";
import { users } from "@voidaccess/db/schema";
import { getAuth } from "../lib/auth/auth";

const [email = "", password = ""] = process.argv.slice(2);
if (!/^delivered\+d1proof[a-z0-9-]*@resend\.dev$/.test(email) || password.length < 10)
  throw new Error("not a d1proof test address");
await getAuth().api.signUpEmail({
  body: { name: "D1 Proof", email, password, aupAccepted: true } as never,
});
const rows = await getDatabase().withSystem("ops.verify-test-account", (tx) =>
  tx.update(users).set({ emailVerified: true }).where(eq(users.email, email)).returning({ id: users.id }),
);
console.log(JSON.stringify({ created: true, verified: rows.length }));
process.exit(rows.length === 1 ? 0 : 1);
