import Link from "next/link";
import { notFound } from "next/navigation";
import { PLANS } from "@voidaccess/config";
import { adminPage } from "@/lib/admin/guard";
import { AdminError } from "@/lib/admin/errors";
import { getUserDetail } from "@/lib/admin/queries";
import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@voidaccess/ui";
import { Empty, Num, Page, Section, StateBadge, Stat, StatGrid, T, Td } from "@/components/admin/ui";
import { fmtDate, int, usd } from "@/components/admin/format";

export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  const admin = await adminPage();
  const { id } = await params;
  let d;
  try {
    d = await getUserDetail(admin.id, id);
  } catch (e) {
    if (e instanceof AdminError) notFound();
    throw e;
  }
  const u = d.user;
  const ft = u.firstTouch;
  const self = u.id === admin.id;
  const refundable = d.investigations.filter((i) => i.credits > 0);
  const api = `/api/admin/users/${u.id}`;
  return (
    <Page
      title={u.email}
      subtitle={`${u.name} · ${u.id}`}
      actions={
        <div className="flex flex-wrap items-center gap-2" data-testid="user-badges">
          <StateBadge value={u.status} />
          <StateBadge value={u.role} />
          <Badge>{PLANS[u.plan].name}</Badge>
          {d.foundingSeat ? <Badge variant="strong">Founding #{d.foundingSeat}</Badge> : null}
        </div>
      }
    >
      <StatGrid>
        <Stat
          label="Signed up"
          value={fmtDate(u.createdAt, false)}
          sub={u.emailVerified ? "email verified" : "email not verified"}
        />
        <Stat label="Monthly credits left" value={int(d.credits.grant)} testId="credits-grant" />
        <Stat
          label="Top-up credits"
          value={int(d.credits.topup)}
          testId="credits-topup"
          sub={`${d.credits.lots.length} lot(s)`}
        />
        <Stat label="Active sessions" value={d.activeSessions} />
      </StatGrid>

      <Section title="Where they came from" hint="First-touch attribution captured at sign-up.">
        <dl
          className="grid gap-px overflow-hidden rounded-lg border border-line bg-line text-[15px] sm:grid-cols-2 [&>div]:flex [&>div]:flex-col [&>div]:gap-2 [&>div]:bg-bg [&>div]:p-5"
          data-testid="attribution"
        >
          <div>
            <dt className="font-mono text-[12px] text-mute">Referral / affiliate code (ref)</dt>
            <dd className="font-mono text-[14px]" data-testid="ref-code">
              {ft?.ref ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[12px] text-mute">Their own referral code</dt>
            <dd className="font-mono text-[14px]">{u.referralCode ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-mono text-[12px] text-mute">Landing page</dt>
            <dd className="font-mono text-[14px] break-all">{ft?.landing ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-mono text-[12px] text-mute">UTM</dt>
            <dd className="font-mono text-[14px] break-all">
              {ft?.utm && Object.keys(ft.utm).length
                ? Object.entries(ft.utm)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("  ")
                : "—"}
            </dd>
          </div>
        </dl>
      </Section>

      <Section
        title="Actions"
        hint="Every action needs a reason and is written to the audit log with your id."
      >
        <div className="grid items-start gap-2.5 md:grid-cols-2" data-testid="actions">
          {u.status === "active" ? (
            <ActionForm
              testId="suspend"
              title="Suspend"
              submit="Suspend user"
              destructive
              endpoint={`${api}/status`}
              hidden={{ action: "suspend" }}
              success="User suspended."
            />
          ) : (
            <ActionForm
              testId="unsuspend"
              title={`Restore access (currently ${u.status})`}
              submit="Restore access"
              endpoint={`${api}/status`}
              hidden={{ action: "unsuspend" }}
              success="Access restored."
            />
          )}
          {u.status !== "banned" ? (
            <ActionForm
              testId="ban"
              title="Ban (also signs them out everywhere)"
              submit="Ban user"
              destructive
              endpoint={`${api}/status`}
              hidden={{ action: "ban" }}
              success="User banned."
            />
          ) : null}
          <ActionForm
            testId="revoke"
            title="Revoke all sessions"
            submit="Revoke sessions"
            endpoint={`${api}/revoke-sessions`}
            success="Sessions revoked."
          />
          <ActionForm
            testId="grant"
            title="Grant credits"
            submit="Grant credits"
            endpoint={`${api}/grant`}
            fields={[{ name: "credits", label: "Credits", type: "number", min: 1, placeholder: "e.g. 500" }]}
            success="Credits granted."
          />
          <ActionForm
            testId="refund"
            title="Refund an investigation"
            submit="Refund"
            endpoint={`${api}/refund`}
            fields={[
              {
                name: "investigationId",
                label: "Investigation (credits kept)",
                type: "select",
                options: refundable.map((i) => ({
                  value: i.id,
                  label: `${fmtDate(i.createdAt, false)} · ${i.credits} credits · ${i.query.slice(0, 40)}`,
                })),
              },
            ]}
            success="Refunded."
          />
        </div>
        {self ? (
          <p className="text-[15px] text-dim">
            This is your own account: status changes are disabled for it.
          </p>
        ) : null}
      </Section>

      <Section
        title="Investigations"
        hint="Query text, status, depth, credits and time. Results are only reachable through the audited review action."
        testId="investigations"
      >
        {d.investigations.length === 0 ? (
          <Empty>No investigations.</Empty>
        ) : (
          <T head={["Query", "Status", "Depth", "Credits kept", "Created", ""]}>
            {d.investigations.map((i) => (
              <tr key={i.id}>
                <Td className="max-w-md break-words">{i.query}</Td>
                <Td>
                  <StateBadge value={i.status} />
                  {i.failureReason ? (
                    <span className="ml-2 font-mono text-[12px] text-dim">{i.failureReason}</span>
                  ) : null}
                </Td>
                <Td>
                  <Num className="text-dim">{i.depth}</Num>
                </Td>
                <Td>
                  <Num>{i.credits}</Num>
                </Td>
                <Td className="whitespace-nowrap">
                  <Num className="text-dim">{fmtDate(i.createdAt)}</Num>
                </Td>
                <Td>
                  {i.status === "completed" ? (
                    <Link href={`/admin/review/${i.id}`} className="va-link whitespace-nowrap">
                      Open for abuse review
                    </Link>
                  ) : null}
                </Td>
              </tr>
            ))}
          </T>
        )}
      </Section>

      <div className="grid gap-12 lg:grid-cols-2">
        <Section title="Subscriptions and payments" testId="billing">
          {d.subscriptions.length === 0 && d.payments.length === 0 ? (
            <Empty>No billing history.</Empty>
          ) : (
            <T head={["What", "Detail", "When"]}>
              {d.subscriptions.map((s, i) => (
                <tr key={`s${i}`}>
                  <Td>Subscription</Td>
                  <Td>
                    {PLANS[s.plan].name} · {s.interval} · {s.status}
                    {s.founding ? " · founding" : ""}
                    {s.cancelAt ? " · cancelling" : ""}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Num className="text-dim">{fmtDate(s.periodEnd, false)}</Num>
                  </Td>
                </tr>
              ))}
              {d.payments.map((p) => (
                <tr key={p.id}>
                  <Td>Payment ({p.kind})</Td>
                  <Td className="font-mono text-[13px] tabular-nums">
                    {usd(p.amountCents / 100, 2)} {p.currency}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Num className="text-dim">{fmtDate(p.paidAt, false)}</Num>
                  </Td>
                </tr>
              ))}
            </T>
          )}
        </Section>
        <Section title="Abuse flags" testId="flags">
          {d.flags.length === 0 ? (
            <Empty>No flags.</Empty>
          ) : (
            <T head={["Kind", "Status", "When"]}>
              {d.flags.map((f) => (
                <tr key={f.id}>
                  <Td>
                    <Num>{f.kind}</Num>
                  </Td>
                  <Td>
                    <StateBadge value={f.status} />
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Num className="text-dim">{fmtDate(f.createdAt)}</Num>
                  </Td>
                </tr>
              ))}
            </T>
          )}
        </Section>
      </div>

      <Section
        title="Audit trail"
        hint="Admin actions and reads that involve this user, newest first."
        testId="trail"
      >
        {d.trail.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <T head={["When", "Actor", "Action", "Reason"]}>
            {d.trail.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap">
                  <Num className="text-dim">{fmtDate(a.at)}</Num>
                </Td>
                <Td>
                  <Num className="text-dim">{a.actor.slice(0, 13)}</Num>
                </Td>
                <Td>
                  <Num>{a.action}</Num>
                </Td>
                <Td className="max-w-md break-words">
                  {typeof a.meta.reason === "string" ? a.meta.reason : ""}
                </Td>
              </tr>
            ))}
          </T>
        )}
      </Section>
    </Page>
  );
}
