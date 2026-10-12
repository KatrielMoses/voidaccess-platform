import { withAdminRoute } from "@/lib/admin/guard";
import { getCostRunsForExport, parseDays, parseDepth } from "@/lib/admin/queries";
import { costsCsv } from "@/lib/admin/costs-csv";
import { getDatabase } from "@voidaccess/db";
import { writeAudit } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET ?days=30&depth=all: the per-run cost-vs-charge table as CSV (no query text). The export itself is audited. */
export function GET(req: Request) {
  return withAdminRoute(req, async (admin) => {
    const sp = new URL(req.url).searchParams;
    const days = parseDays(sp.get("days"));
    const depth = parseDepth(sp.get("depth"));
    const runs = await getCostRunsForExport({ days, depth });
    await getDatabase().withSystem(
      "admin.costs.export_audit",
      (tx) =>
        writeAudit(tx, {
          actor: admin.id,
          action: "admin.costs.export",
          meta: { days, depth, rows: runs.length },
        }),
      { actor: admin.id, audit: false },
    );
    return new Response(costsCsv(runs), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="voidaccess-run-costs-${days}d.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
