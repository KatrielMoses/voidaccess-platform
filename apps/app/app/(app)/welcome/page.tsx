import { DEPTHS } from "@voidaccess/config";
import { pageUser } from "@/lib/page-user";
import { readBalance } from "@/lib/account/balance";
import { getDatabase } from "@voidaccess/db";
import { users } from "@voidaccess/db/schema";
import { eq } from "drizzle-orm";
import { QueryForm } from "@/components/query-form";
import { PageHeader, Row } from "@/components/page-header";
import { ProfileCard } from "./profile-card";

export const metadata = { title: "Welcome | VoidAccess" };

export default async function WelcomePage() {
  const user = await pageUser();
  const balance = await readBalance(user.id);
  const [profile] = await getDatabase().withUser(user.id, (tx) =>
    tx
      .select({ role: users.profileRole, useCase: users.profileUseCase })
      .from(users)
      .where(eq(users.id, user.id)),
  );
  const askProfile = !profile?.role && !profile?.useCase;
  const firstName = user.name.split(" ")[0] ?? user.name;
  return (
    <div className="va-rise flex flex-col gap-16">
      <div className="flex max-w-[860px] flex-col gap-12">
        <PageHeader
          title={`Welcome, ${firstName}`}
          lede="Search the dark web for a threat actor, malware family, CVE or brand. You get a sourced report."
        />
        <QueryForm
          balance={balance}
          emailVerified={user.emailVerified}
          email={user.email}
          fixedDepth="quick"
          showExamples
          autoFocus
        />
      </div>

      <div className="flex flex-col">
        <Row
          title="What credits are"
          note={
            <>
              Each investigation costs a fixed number of credits, shown before you start. You have{" "}
              <span className="font-mono text-[14px] text-paper tabular-nums" data-testid="welcome-balance">
                {balance.toLocaleString("en-US")}
              </span>{" "}
              credits.
            </>
          }
        >
          <ul className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
            <li className="flex flex-col gap-6 bg-bg p-5">
              <span className="font-mono text-[12px] text-mute">01</span>
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-[17px] font-medium tracking-[-0.01em]">Quick investigation</span>
                <span className="font-mono text-[13px] text-paper tabular-nums">
                  {DEPTHS.quick.credits} credits
                </span>
              </span>
            </li>
            <li className="flex flex-col gap-6 bg-bg p-5">
              <span className="font-mono text-[12px] text-mute">02</span>
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-[17px] font-medium tracking-[-0.01em]">Standard investigation</span>
                <span className="font-mono text-[13px] text-paper tabular-nums">
                  {DEPTHS.standard.credits} credits
                </span>
              </span>
            </li>
          </ul>
        </Row>

        {askProfile ? <ProfileCard /> : null}
      </div>
    </div>
  );
}
