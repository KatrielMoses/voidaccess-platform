import Link from "next/link";
import { Badge, Button, EmptyState } from "@voidaccess/ui";
import { pageUser } from "@/lib/page-user";
import { RunError } from "@/lib/runs/errors";
import { listInvestigations } from "@/lib/runs/service";
import { HistoryTable, type HistoryRow } from "./history-table";

export const metadata = { title: "History | VoidAccess" };

const PAGE = 20;
const FILTERS = [
  { value: "", label: "All" },
  { value: "active", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const user = await pageUser();
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").slice(0, 200);
  const status = FILTERS.some((f) => f.value === sp.status) ? (sp.status ?? "") : "";
  let data;
  try {
    data = await listInvestigations(user.id, {
      q,
      status: status || undefined,
      limit: PAGE,
      offset: (page - 1) * PAGE,
    });
  } catch (e) {
    if (!(e instanceof RunError)) throw e;
    data = { items: [], total: 0, limit: PAGE, offset: 0 };
  }
  const rows: HistoryRow[] = data.items.map((r) => ({
    id: r.id,
    title: r.title,
    depth: r.depth,
    status: r.status,
    creditsCharged: r.creditsCharged,
    createdAt: r.createdAt.toISOString(),
  }));
  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  const href = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (status) u.set("status", status);
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return `/investigations${s ? `?${s}` : ""}`;
  };
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">History</h1>
        <Link href="/investigations/new">
          <Button>New investigation</Button>
        </Link>
      </header>

      <form method="get" role="search" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          name="q"
          defaultValue={q}
          aria-label="Search investigations"
          placeholder="Search by title or query"
          className="h-10 w-full rounded-md border border-border-subtle bg-surface px-3 text-sm text-fg placeholder:text-fg-muted hover:border-border-strong focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent-border sm:max-w-sm"
        />
        <select
          name="status"
          defaultValue={status}
          aria-label="Filter by status"
          className="h-10 rounded-md border border-border-subtle bg-surface px-3 text-sm text-fg hover:border-border-strong focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent-border"
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        q || status ? (
          <EmptyState
            title="Nothing matches"
            description="Try a different search or clear the filter."
            action={
              <Link href="/investigations">
                <Button variant="secondary">Clear</Button>
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="No investigations yet"
            description="Your investigations will show up here."
            action={
              <Link href="/investigations/new">
                <Button>Start one</Button>
              </Link>
            }
          />
        )
      ) : (
        <HistoryTable rows={rows} />
      )}

      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm text-fg-secondary">
          {page > 1 ? (
            <Link href={href(page - 1)} className="text-accent underline underline-offset-2">
              Newer
            </Link>
          ) : (
            <span />
          )}
          <Badge>
            Page {page} of {pages}
          </Badge>
          {page < pages ? (
            <Link href={href(page + 1)} className="text-accent underline underline-offset-2">
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
