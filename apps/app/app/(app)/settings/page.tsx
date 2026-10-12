import { PLANS } from "@voidaccess/config";
import { Badge } from "@voidaccess/ui";
import { githubEnabled } from "@/lib/auth/auth";
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
      <SettingsForms
        name={user.name}
        email={user.email}
        emailVerified={user.emailVerified}
        githubEnabled={githubEnabled}
      />
    </div>
  );
}
