import Link from "next/link";
import { pageUser } from "@/lib/page-user";
import { readBalance } from "@/lib/account/balance";
import { getDatabase } from "@voidaccess/db";
import { users } from "@voidaccess/db/schema";
import { eq } from "drizzle-orm";
import { QueryForm } from "@/components/query-form";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { DEPTH_COPY } from "@/content/examples";
import { listInvestigations } from "@/lib/runs/service";
import { ProfileCard } from "./profile-card";

export const metadata = { title: "Investigate | VoidAccess" };

const RECENT = 5;
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The console's home: start an investigation (with the depth choice), and pick up the latest ones. */
export default async function WelcomePage() {
  const user = await pageUser();
  const [balance, [profile], recent] = await Promise.all([
    readBalance(user.id),
    getDatabase().withUser(user.id, (tx) =>
      tx
        .select({ role: users.profileRole, useCase: users.profileUseCase })
        .from(users)
        .where(eq(users.id, user.id)),
    ),
    listInvestigations(user.id, { limit: RECENT, offset: 0 }).catch(() => ({ items: [], total: 0 })),
  ]);
  const askProfile = !profile?.role && !profile?.useCase;
  const firstName = user.name.split(" ")[0] ?? user.name;
  return (
    <div className="va-rise flex flex-col gap-16">
      <div className="flex max-w-[860px] flex-col gap-10">
        <PageHeader
          title={recent.total > 0 ? `Welcome back, ${firstName}` : `Welcome, ${firstName}`}
          lede="Search the dark web for a threat actor, malware family, CVE or brand. You get a sourced report and a graph you can search."
        />
        <QueryForm
          balance={balance}
          emailVerified={user.emailVerified}
          email={user.email}
          // a first investigation starts on Quick (faster, cheaper on the free plan); either depth can be picked
          defaultDepth={recent.total > 0 ? undefined : "quick"}
          showExamples
          autoFocus
        />
      </div>

      {recent.items.length > 0 ? (
        <section aria-labelledby="recent-h" className="flex flex-col gap-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="recent-h" className="text-[21px] font-medium tracking-[-0.02em]">
              Recent investigations
            </h2>
            {recent.total > RECENT ? (
              <Link href="/investigations" className="va-link text-[15px]">
                All {recent.total.toLocaleString("en-US")}
              </Link>
            ) : null}
          </div>
          <ul className="flex flex-col border-t border-line" data-testid="recent-investigations">
            {recent.items.map((r) => (
              <li key={r.id} className="border-b border-line">
                <Link
                  href={`/investigations/${r.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 py-4 transition-colors duration-300 hover:bg-paper/[.03] sm:grid-cols-[1fr_120px_110px_80px]"
                >
                  <span className="truncate text-[16px] text-paper">{r.title}</span>
                  <span className="justify-self-end sm:justify-self-start">
                    <StatusBadge status={r.status} />
                  </span>
                  <span className="font-mono text-[13px] text-dim">
                    {DEPTH_COPY[r.depth as keyof typeof DEPTH_COPY]?.label ?? r.depth}
                  </span>
                  <span className="justify-self-end font-mono text-[13px] text-mute tabular-nums">
                    {day.format(r.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {askProfile ? <ProfileCard /> : null}
    </div>
  );
}
