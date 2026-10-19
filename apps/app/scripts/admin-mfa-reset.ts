// Reset the admin console's authenticator (re-enrolment). Run with the OWNER database URL; there is no UI or API
// for this on purpose. The next visit to the console shows the enrolment screen again.
//   MIGRATE_DATABASE_URL=postgres://owner@host/db \
//   pnpm --filter @voidaccess/app admin:mfa-reset -- --email you@example.com --reason "lost phone"
// The change is audited (audit_log admin.mfa.reset, actor ops:<name>).
import { userInfo } from "node:os";
import { resetAdminMfa } from "../lib/admin/mfa-reset";

const args = process.argv.slice(2).filter((a) => a !== "--");
const get = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const url = process.env.MIGRATE_DATABASE_URL;
const email = get("email");
const reason = get("reason");
if (!url || !email || !reason) {
  console.error(
    'usage: MIGRATE_DATABASE_URL=<owner url> pnpm --filter @voidaccess/app admin:mfa-reset -- --email <email> --reason "<why>" [--actor <name>]',
  );
  process.exit(2);
}
try {
  const r = await resetAdminMfa(url, { email, reason, actor: get("actor") ?? userInfo().username });
  console.log(`${email}: ${r.deleted} authenticator row(s) removed (audited); the next visit enrols again`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
