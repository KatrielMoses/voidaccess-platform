// Production proof helper: issues ONE email sign-in code server-side and prints it, because Turnstile (correctly)
// keeps automated browsers off the real code request and a resend.dev inbox can't be read. Nothing is emailed. The
// code is then used through the real sign-in endpoint, which creates the account on first use (same hooks: free
// grant, referral code).
//   DATABASE_URL=<va_app url> tsx scripts/ops-sign-in-code.ts delivered+d1proof-xxxx@resend.dev
// Refuses anything that is not a Resend test address with the d1proof tag.
import { getAuth } from "../lib/auth/auth";

const [email = ""] = process.argv.slice(2);
if (!/^delivered\+d1proof[a-z0-9-]*@resend\.dev$/.test(email)) throw new Error("not a d1proof test address");
const otp = await getAuth().api.createVerificationOTP({ body: { email, type: "sign-in" } });
console.log(otp);
process.exit(0);
