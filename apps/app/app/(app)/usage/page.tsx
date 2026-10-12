import Link from "next/link";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@voidaccess/ui";
import { pageUser } from "@/lib/page-user";
import { billingCopy as copy, fill } from "@/content/billing";
import { dateFmt, num } from "@/lib/billing/format";
import { LEDGER_REASONS, REASON_LABEL, getBalances, getLedger, isMonth } from "@/lib/billing/usage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Usage" };
const PAGE = 50;

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; month?: string; page?: string }>;
}) {
  const user = await pageUser();
  const sp = await searchParams;
  const reason =
    sp.reason && (LEDGER_REASONS as readonly string[]).includes(sp.reason) ? sp.reason : undefined;
  const month = sp.month && isMonth(sp.month) ? sp.month : undefined;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const [{ rows, hasMore }, bal] = await Promise.all([
    getLedger(user.id, { reason, month, limit: PAGE, offset: page * PAGE }),
    getBalances(user.id),
  ]);

  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { reason, month, page: page || undefined, ...over };
    for (const [k, v] of Object.entries(merged))
      if (v !== undefined && v !== "" && v !== 0) p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{copy.usage.title}</h1>
          <p className="mt-1 text-fg-secondary" data-testid="usage-total">
            {copy.usage.balance}: <span className="font-mono text-fg">{num(bal.total)}</span> credits
          </p>
        </div>
        <a
          href={`/api/usage/export${qs({ page: undefined })}`}
          className="rounded-md border border-border-strong bg-raised px-3 py-2 text-sm hover:bg-overlay focus-visible:outline-2 focus-visible:outline-accent"
          data-testid="usage-csv"
        >
          {copy.usage.download}
        </a>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="bucket-grant">
          <CardHeader>
            <CardTitle>{copy.usage.grantBucket}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-3xl font-semibold">{num(bal.grant)}</p>
            <p className="text-sm text-fg-secondary">
              {bal.grantResetsAt ? fill(copy.usage.resets, { date: dateFmt(bal.grantResetsAt) }) : ""}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="bucket-topup">
          <CardHeader>
            <CardTitle>{copy.usage.topupBucket}</CardTitle>
          </CardHeader>
          <CardContent>
            {bal.lots.length === 0 ? (
              <p className="text-sm text-fg-secondary">{copy.usage.none}</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {bal.lots.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3">
                    <span className="font-mono">{num(l.remaining)}</span>
                    <span className="text-fg-secondary">
                      {fill(copy.usage.expires, { date: dateFmt(l.expiresAt) })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 text-sm" aria-label="Filter the ledger">
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Type
          <select
            name="reason"
            defaultValue={reason ?? ""}
            className="h-10 rounded-md border border-border-subtle bg-surface px-3 text-sm text-fg"
          >
            <option value="">{copy.usage.filters.all}</option>
            {LEDGER_REASONS.map((r) => (
              <option key={r} value={r}>
                {REASON_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          {copy.usage.filters.month}
          <input
            type="month"
            name="month"
            defaultValue={month ?? ""}
            className="h-10 rounded-md border border-border-subtle bg-surface px-3 text-sm text-fg"
          />
        </label>
        <button
          type="submit"
          className="h-10 rounded-md bg-accent px-4 font-medium text-fg-inverse hover:bg-accent/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Apply
        </button>
        {reason || month ? (
          <Link href="/usage" className="pb-2.5 text-accent hover:underline">
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-fg-secondary">
          {copy.usage.empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table
            className="w-full min-w-[40rem] border-collapse text-left text-sm"
            data-testid="ledger-table"
          >
            <thead className="bg-surface text-xs uppercase text-fg-secondary">
              <tr>
                <th className="px-4 py-2">{copy.usage.columns.date}</th>
                <th className="px-4 py-2">{copy.usage.columns.action}</th>
                <th className="px-4 py-2">{copy.usage.columns.investigation}</th>
                <th className="px-4 py-2 text-right">{copy.usage.columns.amount}</th>
                <th className="px-4 py-2">{copy.usage.columns.bucket}</th>
                <th className="px-4 py-2 text-right">{copy.usage.columns.balance}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-dim">
              {rows.map((r) => (
                <tr key={r.id} data-testid="ledger-row">
                  <td className="whitespace-nowrap px-4 py-2 text-fg-secondary">{dateFmt(r.at)}</td>
                  <td className="px-4 py-2">{REASON_LABEL[r.reason] ?? r.reason}</td>
                  <td className="max-w-56 truncate px-4 py-2">
                    {r.investigationId ? (
                      <Link
                        href={`/investigations/${r.investigationId}`}
                        className="text-accent hover:underline"
                      >
                        {r.investigationLabel ?? "Investigation"}
                      </Link>
                    ) : (
                      <span className="text-fg-muted">-</span>
                    )}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-mono ${r.amount < 0 ? "text-fg" : "text-success"}`}
                  >
                    {r.amount > 0 ? `+${num(r.amount)}` : num(r.amount)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={r.bucket === "grant" ? "default" : "accent"}>
                      {r.bucket === "grant" ? "monthly" : "top-up"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{num(r.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav aria-label="Pages" className="flex justify-between text-sm">
        {page > 0 ? (
          <Link href={`/usage${qs({ page: page - 1 || undefined })}`} className="text-accent hover:underline">
            {copy.usage.newer}
          </Link>
        ) : (
          <span />
        )}
        {hasMore ? (
          <Link href={`/usage${qs({ page: page + 1 })}`} className="text-accent hover:underline">
            {copy.usage.older}
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
