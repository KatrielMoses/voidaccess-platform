import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Textarea } from "@voidaccess/ui";
import { adminPage } from "@/lib/admin/guard";
import { AdminError } from "@/lib/admin/errors";
import { openForAbuseReview } from "@/lib/admin/actions";
import { Empty, Num, Page, Section, StateBadge, T, Td, UserLink } from "@/components/admin/ui";
import { fmtDate } from "@/components/admin/format";

/**
 * "Open for abuse review": the only way an admin sees investigation RESULTS. Submitting the reason is the explicit action;
 * each load with a reason writes an audit_log row (actor, investigation, reason, time). Sensitive values stay masked.
 */
export default async function AbuseReview({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reason?: string }>;
}) {
  const admin = await adminPage();
  const { id } = await params;
  const { reason } = await searchParams;
  if (!reason || reason.trim().length < 8) {
    return (
      <Page
        title="Open for abuse review"
        subtitle="Opening results is an audited action. State why you need to see them."
      >
        <form method="get" className="flex max-w-xl flex-col gap-3" data-testid="review-form">
          <label htmlFor="reason" className="text-[15px] text-dim">
            Reason (kept in the audit log)
          </label>
          <Textarea id="reason" name="reason" required minLength={8} maxLength={1000} rows={3} />
          <Button type="submit" className="mt-2 self-start">
            Open results
          </Button>
        </form>
      </Page>
    );
  }
  let r;
  try {
    r = await openForAbuseReview(admin, id, reason);
  } catch (e) {
    if (e instanceof AdminError) notFound();
    throw e;
  }
  const inv = r.investigation;
  return (
    <Page title="Abuse review" subtitle={`Opened by you; reason recorded: “${reason.trim()}”`}>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px]">
        <UserLink id={inv.userId}>Back to user</UserLink>
        <span aria-hidden className="h-3 w-px bg-line-2" />
        <Num className="text-dim">{fmtDate(inv.createdAt)}</Num>
        <span aria-hidden className="h-3 w-px bg-line-2" />
        <Num className="text-dim">{inv.depth}</Num>
        <StateBadge value={inv.status} />
      </p>
      <Section title="Query">
        <p
          className="inline-flex min-h-[46px] items-center self-start rounded-sm bg-paper px-4 py-2.5 font-mono text-[14px] break-words text-ink"
          data-testid="review-query"
        >
          {inv.query}
        </p>
      </Section>
      <Section title="Summary">
        {r.summaryMarkdown ? (
          <pre className="max-h-96 overflow-auto border-y border-line py-5 font-mono text-[13px] leading-[1.6] whitespace-pre-wrap text-dim">
            {r.summaryMarkdown}
          </pre>
        ) : (
          <Empty>No summary.</Empty>
        )}
      </Section>
      <Section
        title={`Entities (${r.entities.length})`}
        hint="Sensitive values are shown masked, as stored for display. Raw values and the credential vault are not read."
      >
        <T head={["Type", "Value", "Confidence"]}>
          {r.entities.map((e, i) => (
            <tr key={i}>
              <Td>
                <Num className="text-dim">{e.type}</Num>
              </Td>
              <Td className="font-mono text-[13px] break-all">
                {e.display}
                {e.sensitive ? " (masked)" : ""}
              </Td>
              <Td>
                <Num>{e.confidence.toFixed(2)}</Num>
              </Td>
            </tr>
          ))}
        </T>
      </Section>
      <Section title={`Sources (${r.sources.length})`}>
        <T head={["Name", "Kind", "URL"]}>
          {r.sources.map((s, i) => (
            <tr key={i}>
              <Td>{s.name}</Td>
              <Td>{s.kind}</Td>
              <Td className="font-mono text-[13px] break-all text-dim">{s.url ?? "—"}</Td>
            </tr>
          ))}
        </T>
      </Section>
      <Link href={`/admin/users/${inv.userId}`} className="ul-link self-start text-[15px]">
        ← User
      </Link>
    </Page>
  );
}
