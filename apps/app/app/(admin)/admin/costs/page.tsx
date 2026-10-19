import { adminHref } from "@/lib/admin/path";
import Link from "next/link";
import { DEPTHS } from "@voidaccess/config";
import { adminPage } from "@/lib/admin/guard";
import { getCostReport, parseDays, parseDepth, PRO_USD_PER_CREDIT } from "@/lib/admin/queries";
import type { CostGroup, CostRun } from "@/lib/admin/queries";
import { buttonVariants, cn } from "@voidaccess/ui";
import { Empty, Page, Section, Stat, StatGrid, T, Td } from "@/components/admin/ui";
import { fmtDate, int, pct, usd } from "@/components/admin/format";

/** Margin against the 80% rule, without hue: below 75% is boxed with ✕, below 80% is marked !, otherwise plain. */
function Margin({ m, testId }: { m: number | null; testId?: string }) {
  return (
    <Td data-testid={testId}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-mono text-[13px] whitespace-nowrap tabular-nums",
          m === null ? "text-mute" : m < 0.8 ? "text-paper" : "text-dim",
          m !== null && m < 0.75 && "rounded-xs border border-line-3 px-1.5 py-0.5",
        )}
      >
        {m !== null && m < 0.75 ? (
          <span aria-hidden>✕</span>
        ) : m !== null && m < 0.8 ? (
          <span aria-hidden>!</span>
        ) : null}
        {pct(m)}
      </span>
    </Td>
  );
}
const n = "font-mono text-[13px] whitespace-nowrap tabular-nums";

const groupRows = (gs: CostGroup[], showPriceCheck: boolean) =>
  gs.map((g) => (
    <tr key={g.key}>
      <Td className={cn(n, "text-paper")}>{g.key}</Td>
      <Td className={n}>{g.runs}</Td>
      <Td className={n}>{usd(g.costP50, 5)}</Td>
      <Td className={n}>{usd(g.costP90, 5)}</Td>
      <Td className={n}>{usd(g.costMax, 5)}</Td>
      <Td className={n}>{usd(g.costTotal, 4)}</Td>
      <Td className={n}>{int(g.creditsNetTotal)}</Td>
      <Margin m={g.marginPro} />
      {showPriceCheck ? <Margin m={g.marginAtP90Pro} testId={`p90-margin-${g.key}`} /> : null}
    </tr>
  ));

const runRows = (rs: CostRun[]) =>
  rs.map((r) => (
    <tr key={r.id}>
      <Td className={cn(n, "text-paper")}>{r.id.slice(0, 8)}</Td>
      <Td className={cn(n, "text-dim")}>{r.depth}</Td>
      <Td className={cn(n, "text-dim")}>
        {r.status}
        {r.failureReason ? ` (${r.failureReason})` : ""}
      </Td>
      <Td className={n}>
        {r.creditsNet}
        {r.creditsReserved !== r.creditsNet ? ` of ${r.creditsReserved}` : ""}
      </Td>
      <Td className={n}>{usd(r.computeUsd, 5)}</Td>
      <Td className={n}>{usd(r.llmUsd, 5)}</Td>
      <Td className={cn(n, "text-paper")}>{usd(r.costUsd, 5)}</Td>
      <Td className={n}>{usd(r.revenueProUsd, 4)}</Td>
      <Margin m={r.marginPro} />
      <Margin m={r.marginList} />
      <Td className={cn(n, "text-dim")}>{fmtDate(r.at)}</Td>
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
          className={buttonVariants({ variant: "secondary" })}
          data-testid="csv-export"
        >
          Download CSV
        </a>
      }
    >
      <nav className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[15px]" aria-label="Filters">
        {[7, 30, 90].map((d) => (
          <Link
            key={d}
            href={adminHref(`/costs?days=${d}&depth=${depth}`)}
            aria-current={d === days ? "true" : undefined}
            className="ul-link"
          >
            {d} days
          </Link>
        ))}
        <span aria-hidden className="h-4 w-px bg-line-2" />
        {(["all", ...Object.keys(DEPTHS)] as const).map((dp) => (
          <Link
            key={dp}
            href={adminHref(`/costs?days=${days}&depth=${dp}`)}
            aria-current={dp === depth ? "true" : undefined}
            className="ul-link"
          >
            {dp}
          </Link>
        ))}
      </nav>

      {r.runs.length === 0 ? (
        <Empty>No measured runs in this range.</Empty>
      ) : (
        <>
          <StatGrid>
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
          </StatGrid>
          <Section
            title="Per depth: the price check"
            hint="Margin at p90 cost uses the depth's price in config and the Pro rate. Below 75% is boxed and marked ✕, below 80% is marked !."
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
          <div className="grid gap-12">
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
