import Link from "next/link";
import { Badge } from "@voidaccess/ui";
import { pageUser } from "@/lib/page-user";
import { getPrefs } from "@/lib/ops/preferences";
import { PageHeader, Row } from "@/components/page-header";
import { NotificationForm } from "./form";

export const metadata = { title: "Notifications | VoidAccess" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await pageUser();
  const prefs = await getPrefs(user.id);
  return (
    <div className="va-rise flex flex-col gap-12">
      <PageHeader
        index={
          <Link href="/settings" className="ul-link">
            ← Settings
          </Link>
        }
        title="Notifications"
        lede={
          <>
            Choose which emails we send to{" "}
            <span className="font-mono text-[15px] text-paper">{user.email}</span>.
          </>
        }
      />
      <div className="flex flex-col">
        <NotificationForm productEmails={prefs.productEmails} />
        <Row
          title="Monitor alerts"
          note="Alerts when something new turns up for a search you are watching. Monitors are not available yet."
          className="border-b"
        >
          <Badge variant="quiet" className="self-start">
            Coming soon
          </Badge>
        </Row>
      </div>
    </div>
  );
}
