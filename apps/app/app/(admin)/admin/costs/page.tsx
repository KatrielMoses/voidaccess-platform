import Link from "next/link";
import { DEPTHS } from "@voidaccess/config";
import { adminPage } from "@/lib/admin/guard";
import { getCostReport, parseDays, parseDepth, PRO_USD_PER_CREDIT } from "@/lib/admin/queries";
import type { CostGroup, CostRun } from "@/lib/admin/queries";
import { Empty, Page, Section, Stat, T, Td } from "@/components/admin/ui";
import { fmtDate, int, pct, usd } from "@/components/admin/format";

const marginClass = (m: number | null) =>
  m === null ? "text-fg-secondary" : m < 0.75 ? "text-danger" : m < 0.8 ? "text-warning" : "text-success";

const groupRows = (gs: CostGroup[], showPriceCheck: boolean) =>
  gs.map((g) => (
    <tr key={g.key}>
      <Td className="font-medium">{g.key}</Td>
      <Td>{g.runs}</Td>
      <Td>{usd(g.costP50, 5)}</Td>
      <Td>{usd(g.costP90, 5)}</Td>
      <Td>{usd(g.costMax, 5)}</Td>
      <Td>{usd(g.costTotal, 4)}</Td>
      <Td>{int(g.creditsNetTotal)}</Td>
      <Td className={marginClass(g.marginPro)}>{pct(g.marginPro)}</Td>
      {showPriceCheck ? (
        <Td className={marginClass(g.marginAtP90Pro)} data-testid={`p90-margin-${g.key}`}>
          {pct(g.marginAtP90Pro)}
        </Td>
      ) : null}
    </tr>
  ));

const runRows = (rs: CostRun[]) =>
  rs.map((r) => (
    <tr key={r.id}>
      <Td className="font-mono text-xs">{r.id.slice(0, 8)}</Td>
      <Td>{r.depth}</Td>
      <Td>
        {r.status}
        {r.failureReason ? ` (${r.failureReason})` : ""}
      </Td>
      <Td>
        {r.creditsNet}
        {r.creditsReserved !== r.creditsNet ? ` of ${r.creditsReserved}` : ""}
      </Td>
      <Td>{usd(r.computeUsd, 5)}</Td>
      <Td>{usd(r.llmUsd, 5)}</Td>
      <Td className="font-medium">{usd(r.costUsd, 5)}</Td>
      <Td>{usd(r.revenueProUsd, 4)}</Td>
      <Td className={marginClass(r.marginPro)}>{pct(r.marginPro)}</Td>
      <Td className={marginClass(r.marginList)}>{pct(r.marginList)}</Td>
      <Td className="whitespace-nowrap">{fmtDate(r.at)}</Td>
    </tr>
  ));
const RUN_HEAD = [
  "Run",
  "Depth",
  "Status",
  "Credits kept",
  "Compute",
  "LLM",
  "Cost",
  "Revenue @Pro",
  "Margin @Pro",
  "Margin @list",
  "Measured",
];

export default async function AdminCosts({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; depth?: string }>;
}) {
  await adminPage();
  const sp = await searchParams;
  const days = parseDays(sp.days);
  const depth = parseDepth(sp.depth);
  const r = await getCostReport({ days, depth });
  const qs = `days=${days}&depth=${depth}`;
  return (
    <Page
      title="Costs"
      subtitle={`Credits kept against measured cost (compute + LLM from run_costs). Revenue @Pro values a credit at the Pro plan rate ($${PRO_USD_PER_CREDIT.toFixed(5)}); @list at the top-up price. Percentiles are over completed runs; the rule is at least 80% margin at p90 cost.`}
      actions={
        <a
          href={`/api/admin/costs/export?${qs}`}
          className="rounded-md border border-border-strong bg-raised px-3 py-1.5 text-sm hover:bg-overlay"
          data-testid="csv-export"
        >
          Download CSV
        </a>
      }
    >
      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Filters">
        {[7, 30, 90].map((d) => (
          <Link
            key={d}
            href={`/admin/costs?days=${d}&depth=${depth}`}
            className={`rounded-md px-2.5 py-1 ${d === days ? "bg-raised text-fg" : "text-fg-secondary hover:text-fg"}`}
          >
            {d} days
          </Link>
        ))}
        <span className="text-fg-muted">|</span>
        {(["all", ...Object.keys(DEPTHS)] as const).map((dp) => (
          <Link
            key={dp}
            href={`/admin/costs?days=${days}&depth=${dp}`}
            className={`rounded-md px-2.5 py-1 ${dp === depth ? "bg-raised text-fg" : "text-fg-secondary hover:text-fg"}`}
          >
            {dp}
          </Link>
        ))}
      </nav>

      {r.runs.length === 0 ? (
        <Empty>No measured runs in this range.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Measured runs" value={int(r.byDepth.reduce((a, g) => a + g.runs, 0))} />
            <Stat
              label="Total cost"
              value={usd(
                r.byDepth.reduce((a, g) => a + g.costTotal, 0),
                2,
              )}
            />
            <Stat
              label="Spent on refunded runs"
              value={usd(r.wastedUsd, 4)}
              sub="cost of runs where no credits were kept"
              testId="wasted"
            />
            <Stat label="Credits kept" value={int(r.byDepth.reduce((a, g) => a + g.creditsNetTotal, 0))} />
          </div>
          <Section
            title="Per depth: the price check"
            hint="Margin at p90 cost uses the depth's price in config and the Pro rate. Red is below 75%, amber below 80%."
            testId="by-depth"
          >
            <T
              head={[
                "Depth",
                "Runs",
                "Cost p50",
                "Cost p90",
                "Cost max",
                "Total cost",
                "Credits kept",
                "Margin @Pro",
                "Margin at p90 cost",
              ]}
            >
              {groupRows(r.byDepth, true)}
            </T>
          </Section>
          <Section title="Per day" testId="by-day">
            <T
              head={[
                "Day",
                "Runs",
                "Cost p50",
                "Cost p90",
                "Cost max",
                "Total cost",
                "Credits kept",
                "Margin @Pro",
              ]}
            >
              {groupRows(r.byDay, false)}
            </T>
          </Section>
          <div className="grid gap-6">
            <Section title="Worst runs by cost" testId="worst-cost">
              <T head={RUN_HEAD}>{runRows(r.worstByCost)}</T>
            </Section>
            <Section title="Lowest margin (completed)" testId="worst-margin">
              <T head={RUN_HEAD}>{runRows(r.worstByMargin)}</T>
            </Section>
            <Section title="Recent runs" hint="Latest 200; the CSV has them all." testId="runs">
              <T head={RUN_HEAD}>{runRows(r.runs)}</T>
            </Section>
          </div>
        </>
      )}
    </Page>
  );
}
