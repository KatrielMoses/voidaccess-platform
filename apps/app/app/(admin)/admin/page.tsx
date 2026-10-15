import { PLANS } from "@voidaccess/config";
import { adminPage } from "@/lib/admin/guard";
import { getOverview } from "@/lib/admin/queries";
import { DODO_DASHBOARD_URL, FIRST_INVESTIGATION_WINDOW_HOURS } from "@/lib/admin/constants";
import { Bar, Empty, Num, Page, Section, Stack, Stat, StatGrid, T, Td } from "@/components/admin/ui";
import { int, pct, usd } from "@/components/admin/format";

export default async function AdminOverview() {
  await adminPage();
  const o = await getOverview();
  const days = [...new Set(o.runsByDay.map((r) => r.day))];
  const maxDay = Math.max(
    1,
    ...days.map((d) => o.runsByDay.filter((r) => r.day === d).reduce((a, r) => a + r.n, 0)),
  );
  const failTotal = o.failureReasons.reduce((a, r) => a + r.n, 0);
  const cur = o.cohorts[0];
  const planName = (p: string) => PLANS[p as keyof typeof PLANS]?.name ?? p;
  return (
    <Page title="Overview" subtitle="Funnel, runs, credits and revenue. Times are UTC.">
      <StatGrid>
        <Stat
          label="Signups, 7 days"
          value={int(o.signups.d7)}
          sub={`${int(o.signups.verifiedD7)} verified`}
          testId="stat-signups-7"
        />
        <Stat
          label="Signups, 30 days"
          value={int(o.signups.d30)}
          sub={`${int(o.signups.verifiedD30)} verified`}
          testId="stat-signups-30"
        />
        <Stat
          label="MRR (subscriptions)"
          value={usd(o.subscriptions.mrrUsd, 2)}
          sub={
            <a href={DODO_DASHBOARD_URL} target="_blank" rel="noopener noreferrer" className="va-link">
              Open Dodo dashboard
            </a>
          }
          testId="stat-mrr"
        />
        <Stat
          label="Founding seats"
          value={`${o.founding.held} / ${o.founding.held + o.founding.available}`}
          sub={`${o.founding.available} available`}
          testId="stat-founding"
        />
      </StatGrid>

      <Section
        title={`#1 metric: first investigation within ${FIRST_INVESTIGATION_WINDOW_HOURS} hours`}
        hint="Of verified signups whose window has closed, the share that completed an investigation inside it, by signup week."
        testId="cohorts"
      >
        {o.cohorts.length === 0 ? (
          <Empty>No signups in this period.</Empty>
        ) : (
          <>
            <p className="text-[15px] text-dim">
              This week:{" "}
              <span className="font-mono text-[15px] text-paper tabular-nums" data-testid="metric-current">
                {pct(cur?.rate ?? null)}
              </span>
              {cur
                ? ` (${cur.converted} of ${cur.matured} verified signups with a closed window; ${cur.verified - cur.matured} still inside it)`
                : null}
            </p>
            <T head={["Signup week (Mon)", "Verified", "Window closed", "Completed in 24 h", "Rate", ""]}>
              {o.cohorts.map((c) => (
                <tr key={c.weekStart}>
                  <Td>
                    <Num className="text-dim">{c.weekStart}</Num>
                  </Td>
                  <Td>
                    <Num>{int(c.verified)}</Num>
                  </Td>
                  <Td>
                    <Num>{int(c.matured)}</Num>
                  </Td>
                  <Td>
                    <Num>{int(c.converted)}</Num>
                  </Td>
                  <Td>
                    <Num className="text-paper">{pct(c.rate)}</Num>
                  </Td>
                  <Td className="w-40 align-middle">
                    <Bar value={c.rate ?? 0} max={1} label={`rate ${pct(c.rate)}`} />
                  </Td>
                </tr>
              ))}
            </T>
          </>
        )}
      </Section>

      <Section title="Runs per day" hint={`Last 14 days, by status. Depth in the columns.`} testId="runs">
        {days.length === 0 ? (
          <Empty>No runs yet.</Empty>
        ) : (
          <T head={["Day", "Quick", "Standard", "Deep", "Total", "Status mix"]}>
            {days.map((d) => {
              const rows = o.runsByDay.filter((r) => r.day === d);
              const by = (depth: string) =>
                rows.filter((r) => r.depth === depth).reduce((a, r) => a + r.n, 0);
              const st = (s: string) => rows.filter((r) => r.status === s).reduce((a, r) => a + r.n, 0);
              const total = rows.reduce((a, r) => a + r.n, 0);
              const active = total - st("completed") - st("failed") - st("cancelled");
              return (
                <tr key={d}>
                  <Td>
                    <Num className="text-dim">{d}</Num>
                  </Td>
                  <Td>
                    <Num>{by("quick")}</Num>
                  </Td>
                  <Td>
                    <Num>{by("standard")}</Num>
                  </Td>
                  <Td>
                    <Num>{by("deep")}</Num>
                  </Td>
                  <Td>
                    <Num className="text-paper">{total}</Num>
                  </Td>
                  <Td className="w-64 align-middle">
                    <div style={{ width: `${(total / maxDay) * 100}%` }} className="min-w-3">
                      <Stack
                        parts={[
                          { label: "completed", n: st("completed"), className: "bg-paper" },
                          { label: "failed", n: st("failed"), className: "bg-paper/45" },
                          { label: "cancelled", n: st("cancelled"), className: "bg-paper/20" },
                          { label: "in progress", n: active, className: "bg-v-500" },
                        ]}
                      />
                    </div>
                  </Td>
                </tr>
              );
            })}
          </T>
        )}
        <p className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[12px] text-dim">
          <span className="flex items-center gap-2">
            <i aria-hidden className="h-1.5 w-4 bg-paper" />
            Completed
          </span>
          <span className="flex items-center gap-2">
            <i aria-hidden className="h-1.5 w-4 bg-paper/45" />
            Failed
          </span>
          <span className="flex items-center gap-2">
            <i aria-hidden className="h-1.5 w-4 bg-paper/20" />
            Cancelled
          </span>
          <span className="flex items-center gap-2">
            <i aria-hidden className="h-1.5 w-4 bg-v-500" />
            In progress
          </span>
        </p>
      </Section>

      <div className="grid gap-12 lg:grid-cols-2">
        <Section title="Why runs failed" hint="Last 30 days." testId="failures">
          {o.failureReasons.length === 0 ? (
            <Empty>No failed runs.</Empty>
          ) : (
            <T head={["Reason", "Runs", "Share", ""]}>
              {o.failureReasons.map((r) => (
                <tr key={r.reason}>
                  <Td>
                    <Num>{r.reason}</Num>
                  </Td>
                  <Td>
                    <Num>{r.n}</Num>
                  </Td>
                  <Td>
                    <Num>{pct(r.n / failTotal, 0)}</Num>
                  </Td>
                  <Td className="w-32 align-middle">
                    <Bar value={r.n} max={failTotal} className="bg-paper/60" />
                  </Td>
                </tr>
              ))}
            </T>
          )}
        </Section>

        <Section title="Credits, 30 days" testId="credits">
          <T head={["", "Credits"]}>
            <tr>
              <Td>Granted (plans, top-ups, bonuses, manual)</Td>
              <Td>
                <Num>{int(o.credits.granted)}</Num>
              </Td>
            </tr>
            <tr>
              <Td>Reserved by runs</Td>
              <Td>
                <Num>{int(o.credits.reserved)}</Num>
              </Td>
            </tr>
            <tr>
              <Td>Refunded</Td>
              <Td>
                <Num>{int(o.credits.refunded)}</Num>
              </Td>
            </tr>
            <tr>
              <Td className="text-paper">Spent (net)</Td>
              <Td>
                <Num className="text-paper">{int(o.credits.spentNet)}</Num>
              </Td>
            </tr>
            <tr>
              <Td>Expired unused</Td>
              <Td>
                <Num>{int(o.credits.expired)}</Num>
              </Td>
            </tr>
          </T>
        </Section>
      </div>

      <Section
        title="Active subscriptions"
        hint="MRR is computed from subscriptions at config prices (founding seats at the founding price)."
        testId="subs"
      >
        {o.subscriptions.byPlan.length === 0 ? (
          <Empty>No paid subscriptions yet.</Empty>
        ) : (
          <T head={["Plan", "Active", "Past due", "Cancelling", "Founding"]}>
            {o.subscriptions.byPlan.map((p) => (
              <tr key={p.plan}>
                <Td>{planName(p.plan)}</Td>
                <Td>
                  <Num>{p.active}</Num>
                </Td>
                <Td>
                  <Num>{p.pastDue}</Num>
                </Td>
                <Td>
                  <Num>{p.cancelling}</Num>
                </Td>
                <Td>
                  <Num>{p.founding}</Num>
                </Td>
              </tr>
            ))}
          </T>
        )}
      </Section>
    </Page>
  );
}
