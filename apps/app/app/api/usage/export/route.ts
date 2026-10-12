import { withUserRoute } from "@/lib/account/route-auth";
import { REASON_LABEL, getLedger } from "@/lib/billing/usage";
import { toCsv } from "@/lib/results/csv";

export const dynamic = "force-dynamic";

/** GET ?reason=&month=YYYY-MM -> the caller's own credit ledger as CSV (formula-injection safe). */
export function GET(req: Request) {
  return withUserRoute(async (user) => {
    const sp = new URL(req.url).searchParams;
    const { rows } = await getLedger(user.id, {
      reason: sp.get("reason") ?? undefined,
      month: sp.get("month") ?? undefined,
      limit: 5000,
    });
    const csv = toCsv(
      ["date_utc", "action", "investigation_id", "investigation", "amount", "bucket", "balance_after"],
      rows.map((r) => [
        r.at.toISOString(),
        REASON_LABEL[r.reason] ?? r.reason,
        r.investigationId,
        r.investigationLabel,
        r.amount,
        r.bucket,
        r.balanceAfter,
      ]),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="voidaccess-usage.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  });
}
