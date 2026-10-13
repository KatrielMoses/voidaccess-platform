// Grant (or revoke) the admin role. Run with the OWNER database URL; there is no UI or API for this on purpose.
//   MIGRATE_DATABASE_URL=postgres://owner@host/db \
//   pnpm --filter @voidaccess/app admin:grant-role -- --email you@example.com --reason "founder"
//   ... --role user   revokes. The change is audited (audit_log, actor ops:<name>).
import { userInfo } from "node:os";
import { setUserRole } from "../lib/admin/role";

const args = process.argv.slice(2).filter((a) => a !== "--");
const get = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const url = process.env.MIGRATE_DATABASE_URL;
const email = get("email");
const role = (get("role") ?? "admin") as "admin" | "user";
const reason = get("reason");
if (!url || !email || !reason || (role !== "admin" && role !== "user")) {
  console.error(
    'usage: MIGRATE_DATABASE_URL=<owner url> pnpm --filter @voidaccess/app admin:grant-role -- --email <email> --reason "<why>" [--role admin|user] [--actor <name>]',
  );
  process.exit(2);
}
try {
  const r = await setUserRole(url, { email, role, reason, actor: get("actor") ?? userInfo().username });
  console.log(
    r.changed
      ? `${email}: ${r.from} -> ${r.to} (audited)`
      : `${email} is already ${r.to} (audited, no change)`,
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
