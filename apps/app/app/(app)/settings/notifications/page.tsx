import Link from "next/link";
import { Badge } from "@voidaccess/ui";
import { pageUser } from "@/lib/page-user";
import { getPrefs } from "@/lib/ops/preferences";
import { NotificationForm } from "./form";

export const metadata = { title: "Notifications | VoidAccess" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await pageUser();
  const prefs = await getPrefs(user.id);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href="/settings" className="text-sm text-fg-secondary hover:text-fg">
          ← Settings
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-fg-secondary">Choose which emails we send to {user.email}.</p>
      </header>
      <NotificationForm productEmails={prefs.productEmails} />
      <section className="rounded-lg border border-border-subtle bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">Monitor alerts</h2>
          <Badge variant="neutral">Coming soon</Badge>
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          Alerts when something new turns up for a search you are watching. Monitors are not available yet.
        </p>
      </section>
    </div>
  );
}
