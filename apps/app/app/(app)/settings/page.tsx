import Link from "next/link";
import { PLANS } from "@voidaccess/config";
import { Badge } from "@voidaccess/ui";
import { githubEnabled, googleEnabled, microsoftEnabled } from "@/lib/auth/auth";
import { pageUser } from "@/lib/page-user";
import { SettingsForms } from "./forms";

export const metadata = { title: "Settings | VoidAccess" };

export default async function SettingsPage() {
  const user = await pageUser();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Settings</h1>
        <Badge variant="accent">{PLANS[user.plan].name} plan</Badge>
      </header>
      <Link
        href="/settings/notifications"
        className="rounded-lg border border-border-subtle bg-surface px-5 py-4 text-sm hover:border-border-strong"
      >
        <span className="font-medium text-fg">Notifications</span>
        <span className="mt-0.5 block text-fg-secondary">Choose which emails you get.</span>
      </Link>
      <SettingsForms
        name={user.name}
        email={user.email}
        providers={[
          ...(googleEnabled ? (["google"] as const) : []),
          ...(microsoftEnabled ? (["microsoft"] as const) : []),
          ...(githubEnabled ? (["github"] as const) : []),
        ]}
      />
    </div>
  );
}
