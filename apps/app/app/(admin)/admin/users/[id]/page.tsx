import Link from "next/link";
import { notFound } from "next/navigation";
import { PLANS } from "@voidaccess/config";
import { adminPage } from "@/lib/admin/guard";
import { AdminError } from "@/lib/admin/errors";
import { getUserDetail } from "@/lib/admin/queries";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Page, Section, StateBadge, Stat, T, Td } from "@/components/admin/ui";
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
          <span className="rounded-full border border-border-subtle px-2.5 py-0.5 text-xs">
            {PLANS[u.plan].name}
          </span>
          {d.foundingSeat ? (
            <span className="rounded-full border border-accent-border px-2.5 py-0.5 text-xs text-accent">
              Founding #{d.foundingSeat}
            </span>
          ) : null}
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
      </div>

      <Section title="Where they came from" hint="First-touch attribution captured at sign-up.">
        <dl
          className="grid gap-x-6 gap-y-2 rounded-lg border border-border-subtle bg-surface p-4 text-sm sm:grid-cols-2"
          data-testid="attribution"
        >
          <div>
            <dt className="text-xs text-fg-secondary">Referral / affiliate code (ref)</dt>
            <dd className="font-mono" data-testid="ref-code">
              {ft?.ref ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-secondary">Their own referral code</dt>
            <dd className="font-mono">{u.referralCode ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-secondary">Landing page</dt>
            <dd className="break-all">{ft?.landing ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-secondary">UTM</dt>
            <dd className="break-all">
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
        <div className="grid gap-3 md:grid-cols-2" data-testid="actions">
          {u.status === "active" ? (
            <ActionForm
              testId="suspend"
              title="Suspend"
              submit="Suspend user"
              danger
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
              danger
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
          <p className="text-xs text-fg-secondary">
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
                    <span className="ml-1 font-mono text-xs text-fg-secondary">{i.failureReason}</span>
                  ) : null}
                </Td>
                <Td>{i.depth}</Td>
                <Td>{i.credits}</Td>
                <Td className="whitespace-nowrap">{fmtDate(i.createdAt)}</Td>
                <Td>
                  {i.status === "completed" ? (
                    <Link href={`/admin/review/${i.id}`} className="text-accent hover:underline">
                      Open for abuse review
                    </Link>
                  ) : null}
                </Td>
              </tr>
            ))}
          </T>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
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
                  <Td className="whitespace-nowrap">{fmtDate(s.periodEnd, false)}</Td>
                </tr>
              ))}
              {d.payments.map((p) => (
                <tr key={p.id}>
                  <Td>Payment ({p.kind})</Td>
                  <Td>
                    {usd(p.amountCents / 100, 2)} {p.currency}
                  </Td>
                  <Td className="whitespace-nowrap">{fmtDate(p.paidAt, false)}</Td>
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
                  <Td className="font-mono text-xs">{f.kind}</Td>
                  <Td>
                    <StateBadge value={f.status} />
                  </Td>
                  <Td className="whitespace-nowrap">{fmtDate(f.createdAt)}</Td>
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
                <Td className="whitespace-nowrap">{fmtDate(a.at)}</Td>
                <Td className="font-mono text-xs">{a.actor.slice(0, 13)}</Td>
                <Td className="font-mono text-xs">{a.action}</Td>
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
