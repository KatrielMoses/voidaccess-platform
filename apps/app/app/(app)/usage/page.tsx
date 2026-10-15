import Link from "next/link";
import { Badge, Button, NativeSelect, buttonVariants, cn, inputClass } from "@voidaccess/ui";
import { PageHeader } from "@/components/page-header";
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

  const th = "h-11 px-4 font-mono text-[12px] font-normal whitespace-nowrap text-mute first:pl-0 last:pr-0";
  const td = "px-4 py-3 first:pl-0 last:pr-0";
  return (
    <div className="va-rise flex flex-col gap-12">
      <PageHeader
        title={copy.usage.title}
        lede={
          <span data-testid="usage-total">
            {copy.usage.balance}:{" "}
            <span className="font-mono text-[15px] text-paper tabular-nums">{num(bal.total)}</span> credits
          </span>
        }
        actions={
          <a
            href={`/api/usage/export${qs({ page: undefined })}`}
            className={buttonVariants({ variant: "secondary" })}
            data-testid="usage-csv"
          >
            {copy.usage.download}
          </a>
        }
      />

      <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2">
        <section data-testid="bucket-grant" className="flex flex-col gap-5 bg-bg p-7 max-[960px]:p-6">
          <h2 className="font-mono text-[12px] leading-none text-mute">{copy.usage.grantBucket}</h2>
          <p className="font-mono text-[40px] leading-none tracking-[-0.04em] tabular-nums max-[960px]:text-[30px]">
            {num(bal.grant)}
          </p>
          <p className="text-[15px] text-dim">
            {bal.grantResetsAt ? fill(copy.usage.resets, { date: dateFmt(bal.grantResetsAt) }) : ""}
          </p>
        </section>
        <section data-testid="bucket-topup" className="flex flex-col gap-5 bg-bg p-7 max-[960px]:p-6">
          <h2 className="font-mono text-[12px] leading-none text-mute">{copy.usage.topupBucket}</h2>
          {bal.lots.length === 0 ? (
            <p className="text-[15px] text-dim">{copy.usage.none}</p>
          ) : (
            <ul className="flex flex-col border-t border-line">
              {bal.lots.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between gap-3 border-b border-line py-2.5"
                >
                  <span className="font-mono text-[15px] tabular-nums">{num(l.remaining)}</span>
                  <span className="text-[15px] text-dim">
                    {fill(copy.usage.expires, { date: dateFmt(l.expiresAt) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex flex-col gap-6">
        <form method="get" className="flex flex-wrap items-end gap-2.5" aria-label="Filter the ledger">
          <label className="flex flex-col gap-2 text-[15px] text-dim">
            Type
            <NativeSelect name="reason" defaultValue={reason ?? ""} className="w-56">
              <option value="">{copy.usage.filters.all}</option>
              {LEDGER_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABEL[r]}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-2 text-[15px] text-dim">
            {copy.usage.filters.month}
            <input
              type="month"
              name="month"
              defaultValue={month ?? ""}
              className={cn(inputClass, "h-[46px] w-52")}
            />
          </label>
          <Button type="submit" variant="secondary" size="lg">
            Apply
          </Button>
          {reason || month ? (
            <Link href="/usage" className="ul-link mb-3.5 ml-2 text-[15px]">
              Clear
            </Link>
          ) : null}
        </form>

        {rows.length === 0 ? (
          <p className="border-y border-line py-10 text-[15px] text-dim">{copy.usage.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full min-w-[40rem] border-collapse text-left text-[15px]"
              data-testid="ledger-table"
            >
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>{copy.usage.columns.date}</th>
                  <th className={th}>{copy.usage.columns.action}</th>
                  <th className={th}>{copy.usage.columns.investigation}</th>
                  <th className={cn(th, "text-right")}>{copy.usage.columns.amount}</th>
                  <th className={th}>{copy.usage.columns.bucket}</th>
                  <th className={cn(th, "text-right")}>{copy.usage.columns.balance}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    data-testid="ledger-row"
                    className="border-b border-line transition-colors duration-300 hover:bg-bg-2"
                  >
                    <td className={cn(td, "font-mono text-[13px] whitespace-nowrap text-dim tabular-nums")}>
                      {dateFmt(r.at)}
                    </td>
                    <td className={td}>{REASON_LABEL[r.reason] ?? r.reason}</td>
                    <td className={cn(td, "max-w-56 truncate")}>
                      {r.investigationId ? (
                        <Link href={`/investigations/${r.investigationId}`} className="va-link">
                          {r.investigationLabel ?? "Investigation"}
                        </Link>
                      ) : (
                        <span className="text-mute">-</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        td,
                        "text-right font-mono text-[13px] tabular-nums",
                        r.amount < 0 ? "text-dim" : "text-paper",
                      )}
                    >
                      {r.amount > 0 ? `+${num(r.amount)}` : num(r.amount)}
                    </td>
                    <td className={td}>
                      <Badge variant={r.bucket === "grant" ? "default" : "strong"}>
                        {r.bucket === "grant" ? "monthly" : "top-up"}
                      </Badge>
                    </td>
                    <td className={cn(td, "text-right font-mono text-[13px] tabular-nums")}>
                      {num(r.balanceAfter)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <nav aria-label="Pages" className="flex justify-between text-[15px]">
          {page > 0 ? (
            <Link href={`/usage${qs({ page: page - 1 || undefined })}`} className="ul-link">
              ← {copy.usage.newer}
            </Link>
          ) : (
            <span />
          )}
          {hasMore ? (
            <Link href={`/usage${qs({ page: page + 1 })}`} className="ul-link">
              {copy.usage.older} →
            </Link>
          ) : null}
        </nav>
      </div>
    </div>
  );
}
