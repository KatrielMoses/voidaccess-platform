import { PLANS } from "@voidaccess/config";
import { adminPage } from "@/lib/admin/guard";
import { getOverview } from "@/lib/admin/queries";
import { DODO_DASHBOARD_URL, FIRST_INVESTIGATION_WINDOW_HOURS } from "@/lib/admin/constants";
import { Bar, Empty, Page, Section, Stack, Stat, T, Td } from "@/components/admin/ui";
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
            <a
              href={DODO_DASHBOARD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
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
      </div>

      <Section
        title={`#1 metric: first investigation within ${FIRST_INVESTIGATION_WINDOW_HOURS} hours`}
        hint="Of verified signups whose window has closed, the share that completed an investigation inside it, by signup week."
        testId="cohorts"
      >
        {o.cohorts.length === 0 ? (
          <Empty>No signups in this period.</Empty>
        ) : (
          <>
            <p className="text-sm text-fg-secondary">
              This week:{" "}
              <span className="font-medium text-fg" data-testid="metric-current">
                {pct(cur?.rate ?? null)}
              </span>
              {cur
                ? ` (${cur.converted} of ${cur.matured} verified signups with a closed window; ${cur.verified - cur.matured} still inside it)`
                : null}
            </p>
            <T head={["Signup week (Mon)", "Verified", "Window closed", "Completed in 24 h", "Rate", ""]}>
              {o.cohorts.map((c) => (
                <tr key={c.weekStart}>
                  <Td>{c.weekStart}</Td>
                  <Td>{int(c.verified)}</Td>
                  <Td>{int(c.matured)}</Td>
                  <Td>{int(c.converted)}</Td>
                  <Td className="font-medium">{pct(c.rate)}</Td>
                  <Td className="w-40">
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
                  <Td>{d}</Td>
                  <Td>{by("quick")}</Td>
                  <Td>{by("standard")}</Td>
                  <Td>{by("deep")}</Td>
                  <Td className="font-medium">{total}</Td>
                  <Td className="w-64">
                    <div style={{ width: `${(total / maxDay) * 100}%` }} className="min-w-3">
                      <Stack
                        parts={[
                          { label: "completed", n: st("completed"), className: "bg-success" },
                          { label: "failed", n: st("failed"), className: "bg-danger" },
                          { label: "cancelled", n: st("cancelled"), className: "bg-fg-muted" },
                          { label: "in progress", n: active, className: "bg-accent" },
                        ]}
                      />
                    </div>
                  </Td>
                </tr>
              );
            })}
          </T>
        )}
        <p className="text-xs text-fg-secondary">
          Green completed, red failed, grey cancelled, accent in progress.
        </p>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Why runs failed" hint="Last 30 days." testId="failures">
          {o.failureReasons.length === 0 ? (
            <Empty>No failed runs.</Empty>
          ) : (
            <T head={["Reason", "Runs", "Share", ""]}>
              {o.failureReasons.map((r) => (
                <tr key={r.reason}>
                  <Td className="font-mono text-xs">{r.reason}</Td>
                  <Td>{r.n}</Td>
                  <Td>{pct(r.n / failTotal, 0)}</Td>
                  <Td className="w-32">
                    <Bar value={r.n} max={failTotal} className="bg-danger" />
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
              <Td>{int(o.credits.granted)}</Td>
            </tr>
            <tr>
              <Td>Reserved by runs</Td>
              <Td>{int(o.credits.reserved)}</Td>
            </tr>
            <tr>
              <Td>Refunded</Td>
              <Td>{int(o.credits.refunded)}</Td>
            </tr>
            <tr>
              <Td className="font-medium">Spent (net)</Td>
              <Td className="font-medium">{int(o.credits.spentNet)}</Td>
            </tr>
            <tr>
              <Td>Expired unused</Td>
              <Td>{int(o.credits.expired)}</Td>
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
                <Td>{p.active}</Td>
                <Td>{p.pastDue}</Td>
                <Td>{p.cancelling}</Td>
                <Td>{p.founding}</Td>
              </tr>
            ))}
          </T>
        )}
      </Section>
    </Page>
  );
}
