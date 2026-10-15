import { adminPage } from "@/lib/admin/guard";
import { getAbuseQueue } from "@/lib/admin/queries";
import { ABUSE_BLOCKED_THRESHOLD, ABUSE_WINDOW_DAYS } from "@/lib/admin/constants";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Num, Page, Section, T, Td, UserLink } from "@/components/admin/ui";
import { fmtDate } from "@/components/admin/format";

const review = (kind: "flag" | "run" | "user", id: string) => (
  <ActionForm
    testId={`review-${kind}-${id.slice(0, 8)}`}
    title="Mark reviewed"
    submit="Mark reviewed"
    endpoint="/api/admin/abuse/review"
    hidden={{ kind, id, status: "reviewed" }}
    success="Marked reviewed."
  />
);

export default async function AdminAbuse() {
  const admin = await adminPage();
  const q = await getAbuseQueue(admin.id);
  const total = q.blockedRuns.length + q.repeatUsers.length + q.flags.length;
  return (
    <Page
      title="Abuse queue"
      subtitle={`${total} item(s) waiting. Opening this page is an audited read (it shows query text).`}
    >
      <Section
        title="Users with repeated blocked queries"
        hint={`${ABUSE_BLOCKED_THRESHOLD} or more blocked queries in ${ABUSE_WINDOW_DAYS} days.`}
        testId="repeat-users"
      >
        {q.repeatUsers.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <T head={["User", "Blocked runs", "Latest", "Review"]}>
            {q.repeatUsers.map((u) => (
              <tr key={u.userId}>
                <Td>
                  <UserLink id={u.userId}>{u.email}</UserLink>
                </Td>
                <Td>
                  <Num>{u.blocked}</Num>
                </Td>
                <Td className="whitespace-nowrap">
                  <Num className="text-dim">{fmtDate(u.lastAt)}</Num>
                </Td>
                <Td className="min-w-64">{review("user", u.userId)}</Td>
              </tr>
            ))}
          </T>
        )}
      </Section>

      <Section
        title="Blocked queries"
        hint="Runs the engine refused (failure reason blocked_query). The user was refunded."
        testId="blocked-runs"
      >
        {q.blockedRuns.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <T head={["User", "Query", "When", "Review"]}>
            {q.blockedRuns.map((r) => (
              <tr key={r.id}>
                <Td>
                  <UserLink id={r.userId}>{r.email}</UserLink>
                </Td>
                <Td className="max-w-md break-words">{r.query}</Td>
                <Td className="whitespace-nowrap">
                  <Num className="text-dim">{fmtDate(r.createdAt)}</Num>
                </Td>
                <Td className="min-w-64">{review("run", r.id)}</Td>
              </tr>
            ))}
          </T>
        )}
      </Section>

      <Section
        title="Flags"
        hint="Refunds and disputes from billing, founding-seat claim races, anything raised by hand."
        testId="flags"
      >
        {q.flags.length === 0 ? (
          <Empty>No open flags.</Empty>
        ) : (
          <T head={["User", "Kind", "Detail", "When", "Review"]}>
            {q.flags.map((f) => (
              <tr key={f.id}>
                <Td>
                  {f.userId ? <UserLink id={f.userId}>{f.email ?? f.userId.slice(0, 8)}</UserLink> : "—"}
                </Td>
                <Td>
                  <Num>{f.kind}</Num>
                </Td>
                <Td className="max-w-sm font-mono text-[12px] break-words text-dim">
                  {JSON.stringify(f.detail).slice(0, 200)}
                </Td>
                <Td className="whitespace-nowrap">
                  <Num className="text-dim">{fmtDate(f.createdAt)}</Num>
                </Td>
                <Td className="min-w-64">{review("flag", f.id)}</Td>
              </tr>
            ))}
          </T>
        )}
      </Section>

      <Section
        title="Rate-limit hits"
        hint="Per-account hits, last 30 days (recorded by the hardening work)."
        testId="rate-limits"
      >
        {!q.rateLimits.available || q.rateLimits.rows.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <T head={["User", "Hits", "Latest"]}>
            {q.rateLimits.rows.map((r) => (
              <tr key={r.userId}>
                <Td>
                  <UserLink id={r.userId}>{r.email ?? r.userId.slice(0, 8)}</UserLink>
                </Td>
                <Td>
                  <Num>{r.hits}</Num>
                </Td>
                <Td className="whitespace-nowrap">
                  <Num className="text-dim">{fmtDate(r.lastAt)}</Num>
                </Td>
              </tr>
            ))}
          </T>
        )}
      </Section>
    </Page>
  );
}
