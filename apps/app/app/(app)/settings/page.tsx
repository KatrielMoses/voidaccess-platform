import Link from "next/link";
import { PLANS } from "@voidaccess/config";
import { Badge } from "@voidaccess/ui";
import { githubEnabled, googleEnabled, microsoftEnabled } from "@/lib/auth/auth";
import { pageUser } from "@/lib/page-user";
import { PageHeader, Row } from "@/components/page-header";
import { SUPPORT_EMAIL } from "@/lib/site";
import { SettingsForms } from "./forms";

export const metadata = { title: "Settings | VoidAccess" };

export default async function SettingsPage() {
  const user = await pageUser();
  return (
    <div className="va-rise flex flex-col gap-12">
      <PageHeader title="Settings" actions={<Badge variant="strong">{PLANS[user.plan].name} plan</Badge>} />
      <div className="flex flex-col">
        <SettingsForms
          name={user.name}
          email={user.email}
          providers={[
            ...(googleEnabled ? (["google"] as const) : []),
            ...(microsoftEnabled ? (["microsoft"] as const) : []),
            ...(githubEnabled ? (["github"] as const) : []),
          ]}
          notifications={
            <Row title="Notifications" note="Choose which emails you get.">
              <Link href="/settings/notifications" className="ul-link self-start text-[15px]">
                Email preferences →
              </Link>
            </Row>
          }
        />
        <Row title="Support" note="Questions, refunds or a problem with an investigation.">
          <a href={`mailto:${SUPPORT_EMAIL}`} className="ul-link self-start text-[15px]">
            {SUPPORT_EMAIL}
          </a>
        </Row>
      </div>
    </div>
  );
}
