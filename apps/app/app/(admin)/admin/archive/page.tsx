import { Button, Input } from "@voidaccess/ui";
import { adminPage } from "@/lib/admin/guard";
import { listArchiveRemovals, searchArchive } from "@/lib/admin/queries";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Page, Section, T, Td } from "@/components/admin/ui";
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
      <form method="get" className="flex max-w-xl gap-2" role="search">
        <Input
          name="q"
          defaultValue={q}
          placeholder="value, URL, host, uuid or page hash"
          aria-label="Search the archive"
          data-testid="archive-search"
        />
        <Button type="submit">Search</Button>
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
                  <span className="mr-1 rounded border border-border-subtle px-1.5 py-0.5 text-xs">
                    {h.kind}
                  </span>
                  {h.label}
                  <span className="block text-xs text-fg-secondary">{h.detail}</span>
                </Td>
                <Td>{h.tier ?? "—"}</Td>
                <Td className="whitespace-nowrap">{fmtDate(h.firstSeen, false)}</Td>
                <Td className="whitespace-nowrap">{fmtDate(h.lastSeen, false)}</Td>
                <Td>{h.observations}</Td>
                <Td className="min-w-72">
                  {h.tombstoned ? (
                    <span className="text-xs text-fg-secondary">Removed</span>
                  ) : (
                    <ActionForm
                      testId={`remove-${h.kind}-${h.key.slice(0, 8)}`}
                      title="Remove"
                      submit={`Remove this ${h.kind}`}
                      danger
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
                <Td className="whitespace-nowrap">{fmtDate(r.at)}</Td>
                <Td className="font-mono text-xs">{r.actor.slice(0, 13)}</Td>
                <Td className="max-w-sm font-mono text-xs break-all">{r.target}</Td>
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
