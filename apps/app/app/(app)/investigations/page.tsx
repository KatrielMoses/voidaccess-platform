import Link from "next/link";
import {
  Button,
  ButtonArrow,
  EmptyState,
  NativeSelect,
  buttonVariants,
  cn,
  inputClass,
} from "@voidaccess/ui";
import { PageHeader } from "@/components/page-header";
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
    <div className="va-rise flex flex-col gap-10">
      <PageHeader
        title="History"
        lede="Every investigation you have run, newest first."
        actions={
          <Link href="/investigations/new" className={cn(buttonVariants(), "group/btn")}>
            <span className="inline-flex items-center gap-2.5">
              New investigation
              <ButtonArrow />
            </span>
          </Link>
        }
      />

      <form method="get" role="search" className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <input
          type="search"
          name="q"
          defaultValue={q}
          aria-label="Search investigations"
          placeholder="Search by title or query"
          className={cn(inputClass, "h-[46px] sm:max-w-md")}
        />
        <NativeSelect name="status" defaultValue={status} aria-label="Filter by status" className="sm:w-52">
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="secondary" size="lg">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        q || status ? (
          <EmptyState
            title="Nothing matches"
            description="Try a different search or clear the filter."
            action={
              <Link href="/investigations" className={buttonVariants({ variant: "secondary" })}>
                Clear
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="No investigations yet"
            description="Your investigations will show up here."
            action={
              <Link href="/investigations/new" className={buttonVariants({ variant: "secondary" })}>
                Start one
              </Link>
            }
          />
        )
      ) : (
        <HistoryTable rows={rows} />
      )}

      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-[15px]">
          {page > 1 ? (
            <Link href={href(page - 1)} className="ul-link">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="font-mono text-[12px] text-mute tabular-nums">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} className="ul-link">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
