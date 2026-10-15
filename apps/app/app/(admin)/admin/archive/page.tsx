import { Button, Input } from "@voidaccess/ui";
import { adminPage } from "@/lib/admin/guard";
import { listArchiveRemovals, searchArchive } from "@/lib/admin/queries";
import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@voidaccess/ui";
import { Empty, Num, Page, Section, T, Td } from "@/components/admin/ui";
import { fmtDate } from "@/components/admin/format";

export default async function AdminArchive({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await adminPage();
  const { q = "" } = await searchParams;
  const [hits, removals] = await Promise.all([searchArchive(q), listArchiveRemovals()]);
  return (
    <Page
      title="Archive"
      subtitle="The shared archive has no link to any user or query. Search by value, URL, host, id or page hash; removing tombstones the row, deletes the stored page and is audited."
    >
      <form method="get" className="flex max-w-xl gap-2.5" role="search">
        <Input
          name="q"
          defaultValue={q}
          placeholder="value, URL, host, uuid or page hash"
          aria-label="Search the archive"
          data-testid="archive-search"
        />
        <Button type="submit" variant="secondary" size="lg">
          Search
        </Button>
      </form>
      {q ? (
        hits.length === 0 ? (
          <Empty>Nothing matches “{q}”.</Empty>
        ) : (
          <T
            testId="archive-hits"
            head={["What", "Tier", "First seen", "Last seen", "Observations", "Remove"]}
          >
            {hits.map((h) => (
              <tr key={`${h.kind}:${h.key}`} data-testid="archive-hit">
                <Td className="max-w-md break-all">
                  <Badge className="mr-2 align-[2px]">{h.kind}</Badge>
                  {h.label}
                  <span className="mt-1 block font-mono text-[12px] text-dim">{h.detail}</span>
                </Td>
                <Td>
                  <Num className="text-dim">{h.tier ?? "—"}</Num>
                </Td>
                <Td className="whitespace-nowrap">
                  <Num className="text-dim">{fmtDate(h.firstSeen, false)}</Num>
                </Td>
                <Td className="whitespace-nowrap">
                  <Num className="text-dim">{fmtDate(h.lastSeen, false)}</Num>
                </Td>
                <Td>
                  <Num>{h.observations}</Num>
                </Td>
                <Td className="min-w-72">
                  {h.tombstoned ? (
                    <span className="font-mono text-[12.5px] text-mute">Removed</span>
                  ) : (
                    <ActionForm
                      testId={`remove-${h.kind}-${h.key.slice(0, 8)}`}
                      title="Remove"
                      submit={`Remove this ${h.kind}`}
                      destructive
                      endpoint="/api/admin/archive/remove"
                      hidden={{ kind: h.kind, key: h.key }}
                      success="Removed."
                    />
                  )}
                </Td>
              </tr>
            ))}
          </T>
        )
      ) : (
        <Empty>Search to see archive entries.</Empty>
      )}
      <Section title="Past removals" testId="removals">
        {removals.length === 0 ? (
          <Empty>No removals yet.</Empty>
        ) : (
          <T head={["When", "By", "What", "Reason"]}>
            {removals.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">
                  <Num className="text-dim">{fmtDate(r.at)}</Num>
                </Td>
                <Td>
                  <Num className="text-dim">{r.actor.slice(0, 13)}</Num>
                </Td>
                <Td className="max-w-sm font-mono text-[12.5px] break-all">{r.target}</Td>
                <Td className="max-w-md break-words">
                  {typeof r.meta.reason === "string" ? r.meta.reason : ""}
                </Td>
              </tr>
            ))}
          </T>
        )}
      </Section>
    </Page>
  );
}
