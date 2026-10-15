"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  cn,
} from "@voidaccess/ui";
import { FOUNDING, PLANS, TOPUP_EXPIRY_MONTHS, type PlanId } from "@voidaccess/config";
import { billingCopy as copy, fill } from "@/content/billing";
import { dateFmt, centsToUsd, num, usd } from "@/lib/billing/format";
import type { BillingView } from "@/lib/billing/view";
import { Notice, Row, SectionTitle } from "@/components/page-header";

type Interval = "month" | "year";
interface Preview {
  kind: "upgrade" | "downgrade" | "same";
  amountCents: number | null;
  effectiveAt: string | null;
  releasesFoundingSeat: boolean;
}

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

const monthsFree = (p: PlanId) =>
  PLANS[p].annualUsd ? 12 - Math.round(PLANS[p].annualUsd! / PLANS[p].monthlyUsd) : 0;

export function BillingClient({ view, checkout }: { view: BillingView; checkout?: string }) {
  const [interval, setInterval] = useState<Interval>(view.sub?.interval ?? "month");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [change, setChange] = useState<{ plan: PlanId; interval: Interval; preview: Preview } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  const live = view.sub && view.sub.status !== "cancelled";
  const ending = view.sub?.cancelAt ?? null;

  async function go(url: string, body: unknown, id: string) {
    setBusy(id);
    setError(null);
    const r = await post<{ url?: string; error?: string }>(url, body);
    if (r.ok && r.data.url) window.location.href = r.data.url;
    else {
      setError(
        r.data.error === "founding_unavailable"
          ? copy.founding.soldOut
          : "That didn't work. Please try again.",
      );
      setBusy(null);
    }
  }

  async function startChange(plan: PlanId, iv: Interval) {
    setBusy(`change-${plan}`);
    setError(null);
    const r = await post<Preview & { error?: string }>("/api/billing/change/preview", { plan, interval: iv });
    setBusy(null);
    if (!r.ok) return setError("We couldn't price that change. Please try again.");
    setChange({ plan, interval: iv, preview: r.data });
  }

  async function confirmChange() {
    if (!change) return;
    setBusy("confirm");
    const r = await post<{ error?: string }>("/api/billing/change", {
      plan: change.plan,
      interval: change.interval,
      confirmReleaseFounding: true,
    });
    if (!r.ok) {
      setError("That change didn't go through.");
      setBusy(null);
      return;
    }
    window.location.href = "/billing?checkout=changed";
  }

  async function cancel() {
    setBusy("cancel");
    const r = await post("/api/billing/cancel", { reason: reason.trim() || undefined });
    if (r.ok) window.location.reload();
    else setBusy(null);
  }

  async function simple(url: string, method = "POST") {
    setBusy(url);
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
    });
    if (res.ok && url.endsWith("portal")) window.location.href = ((await res.json()) as { url: string }).url;
    else if (res.ok) window.location.reload();
    else setBusy(null);
  }

  const price = (p: BillingView["plans"][number]) =>
    interval === "year" && p.annualUsd !== null ? p.annualUsd : p.monthlyUsd;

  // One violet thing per view: the founding field when it is on offer, otherwise Pro's subscribe button.
  const primaryPlan: PlanId | null = view.canClaimFounding || live ? null : "pro";

  return (
    <div className="flex flex-col gap-14">
      {checkout === "success" || error || view.sub?.status === "past_due" ? (
        <div className="flex flex-col gap-3">
          {checkout === "success" ? (
            <Notice role="status" mark="✓" tone="quiet" data-testid="checkout-return">
              <p className="text-paper">
                Thanks! Your plan updates as soon as Dodo confirms the payment, usually within a minute.
              </p>
            </Notice>
          ) : null}
          {error ? (
            <Notice role="alert" mark="✕">
              <p>{error}</p>
            </Notice>
          ) : null}
          {view.sub?.status === "past_due" ? (
            <Notice role="alert" mark="!" data-testid="past-due">
              <p>
                {copy.subscription.pastDue}{" "}
                <button type="button" onClick={() => simple("/api/billing/portal")} className="va-link">
                  {copy.alerts.updatePayment}
                </button>
              </p>
            </Notice>
          ) : null}
        </div>
      ) : null}

      {live || view.founding.held ? (
        <div className="flex flex-col">
          {live ? (
            <Row title={copy.subscription.heading} testId="subscription-panel">
              <div className="flex flex-col gap-2">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-[21px] font-medium tracking-[-0.02em]">
                    {PLANS[view.sub!.plan].name}
                  </span>
                  <span className="font-mono text-[12.5px] text-dim">
                    {view.sub!.interval === "year" ? copy.annual : copy.monthly}
                  </span>
                  {view.sub!.isFounding ? <Badge variant="strong">Founding member</Badge> : null}
                </p>
                <p className="text-[15px] text-dim" data-testid="renewal-line">
                  {ending
                    ? fill(copy.subscription.endsOn, { date: dateFmt(ending) })
                    : fill(copy.subscription.renews, { date: dateFmt(view.sub!.currentPeriodEnd) })}
                </p>
                {view.sub!.pending ? (
                  <p className="text-[15px] text-dim" data-testid="pending-line">
                    {fill(copy.subscription.pendingDowngrade, {
                      plan: PLANS[view.sub!.pending.plan].name,
                      date: dateFmt(view.sub!.pending.at),
                    })}{" "}
                    <button
                      type="button"
                      onClick={() => simple("/api/billing/pending", "DELETE")}
                      className="va-link"
                    >
                      Undo
                    </button>
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Button
                  variant="secondary"
                  loading={busy === "/api/billing/portal"}
                  onClick={() => simple("/api/billing/portal")}
                  data-testid="portal"
                >
                  {copy.subscription.portal}
                </Button>
                {ending ? (
                  <Button
                    loading={busy === "/api/billing/resume"}
                    onClick={() => simple("/api/billing/resume")}
                  >
                    {copy.subscription.resume}
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setCancelOpen(true)} data-testid="cancel-open">
                    {copy.subscription.cancel}
                  </Button>
                )}
              </div>
              <p className="text-[15px] text-mute">{copy.subscription.portalHelp}</p>
            </Row>
          ) : null}

          {view.founding.held ? (
            <Row title={copy.founding.yourSeat} testId="founder-panel">
              <p className="text-[15px] text-dim">
                {copy.founding.termEnds}:{" "}
                <span className="font-mono text-[14px] text-paper">{dateFmt(view.founding.termEnd)}</span>
              </p>
              <p className="flex items-center gap-2 text-[15px] text-paper" data-testid="founder-status">
                <span aria-hidden className="font-mono text-[12px]">
                  {view.founding.status === "at_risk" ? "!" : "✓"}
                </span>
                {view.founding.status === "at_risk"
                  ? `${copy.founding.status.at_risk}${view.founding.releasingOn ? ` (${dateFmt(view.founding.releasingOn)})` : ""}`
                  : copy.founding.status.renews}
              </p>
            </Row>
          ) : null}
        </div>
      ) : null}

      {view.canClaimFounding || (!view.sub && view.seats.available <= 0) ? (
        // The one violet field on the page (design.md §3.2): paper text, v-100 for secondary text, a paper button.
        <section
          className="grid grid-cols-12 gap-x-6 gap-y-8 rounded-lg bg-v-600 p-10 text-paper max-[960px]:grid-cols-1 max-[960px]:p-6"
          data-testid="founding-banner"
          aria-labelledby="founding-h"
        >
          <div className="col-span-5 flex flex-col gap-5 max-[960px]:col-span-1">
            <h2
              id="founding-h"
              className="text-[clamp(28px,2.6vw,38px)] leading-[1.04] font-medium tracking-[-0.04em]"
            >
              {fill(copy.founding.heading, { price: usd(FOUNDING.monthlyUsd) })}
            </h2>
            <p className="text-[15px] leading-[1.55] text-v-100">{FOUNDING.copy}</p>
            <p className="font-mono text-[13px] text-paper tabular-nums" data-testid="seat-counter">
              {fill(copy.founding.counter, { available: view.seats.available, total: view.seats.total })}
            </p>
            {view.canClaimFounding ? (
              <div className="mt-2 flex flex-col items-start gap-3">
                <Button
                  variant="paper"
                  size="lg"
                  loading={busy === "founding"}
                  onClick={() =>
                    go(
                      "/api/billing/checkout",
                      { kind: "subscription", plan: "pro", interval: "month", founding: true },
                      "founding",
                    )
                  }
                  data-testid="founding-cta"
                >
                  {copy.checkout.foundingCta}
                </Button>
                <p className="text-[15px] leading-[1.5] text-v-100">
                  {fill(copy.checkout.foundingNotice, {
                    price: usd(FOUNDING.monthlyUsd),
                    line: FOUNDING.copy,
                  })}
                </p>
              </div>
            ) : (
              <p className="text-[15px] text-paper">{copy.founding.soldOut}</p>
            )}
          </div>
          <ol className="col-span-6 col-start-7 flex flex-col border-t border-paper/30 max-[960px]:col-span-1 max-[960px]:col-start-1">
            {copy.founding.rules.map((r, i) => (
              <li
                key={r}
                className="grid grid-cols-[36px_1fr] gap-2 border-b border-paper/30 py-3.5 text-[15px] leading-[1.5]"
              >
                <span className="pt-[3px] font-mono text-[12px] text-v-100">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  {fill(r, {
                    seats: FOUNDING.seats,
                    price: usd(FOUNDING.monthlyUsd),
                    credits: num(FOUNDING.monthlyCredits),
                    termMonths: FOUNDING.termMonths,
                    renewalMonths: FOUNDING.renewalMinPaidMonthsInTrailing12,
                    inactivityMonths: FOUNDING.inactivityReleaseMonths,
                    noticeDays: FOUNDING.noticeDaysBeforeRelease,
                    proPrice: usd(PLANS[FOUNDING.plan].monthlyUsd),
                  })}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="plans-h" className="flex flex-col gap-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionTitle id="plans-h">Plans</SectionTitle>
          <div
            role="group"
            aria-label="Billing period"
            className="inline-flex h-10 items-center rounded-sm border border-line p-[3px]"
          >
            {(["month", "year"] as const).map((iv) => (
              <button
                key={iv}
                type="button"
                aria-pressed={interval === iv}
                onClick={() => setInterval(iv)}
                data-testid={`interval-${iv}`}
                className={cn(
                  "inline-flex h-full items-center gap-2 rounded-xs px-3.5 text-[15px] transition-colors duration-300",
                  interval === iv ? "bg-paper text-ink" : "text-dim hover:text-paper",
                )}
              >
                {iv === "month" ? copy.monthly : copy.annual}
                {iv === "year" ? (
                  <span
                    className={cn("font-mono text-[11.5px]", interval === iv ? "text-stone" : "text-mute")}
                  >
                    {fill(copy.annualNote, { monthsFree: monthsFree("pro") })}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
        <ul className="grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3">
          {view.plans.map((p) => {
            const isCurrent =
              (p.id === "free"
                ? view.plan === "free" && !live
                : live &&
                  view.sub!.plan === p.id &&
                  (view.sub!.interval === interval || p.annualUsd === null)) ||
              (p.id === "free" && !live && view.plan === "free");
            const key = `${p.id}_${interval}`;
            return (
              <li
                key={p.id}
                className={cn("flex flex-col gap-6 p-7 max-[960px]:p-6", isCurrent ? "bg-bg-2" : "bg-bg")}
                data-testid={`plan-${p.id}`}
              >
                <div className="flex min-h-6 items-center justify-between gap-3">
                  <h3 className="text-[23px] leading-none font-medium tracking-[-0.025em]">{p.name}</h3>
                  {isCurrent ? <Badge variant="strong">{copy.currentPlan}</Badge> : null}
                </div>
                <div className="flex flex-col gap-3">
                  <p className="flex items-baseline gap-1.5">
                    <span className="font-mono text-[32px] leading-none tracking-[-0.04em] tabular-nums">
                      {usd(price(p))}
                    </span>
                    <span className="font-mono text-[13px] text-dim">
                      {p.id === "free" ? copy.perMonth : interval === "year" ? copy.perYear : copy.perMonth}
                    </span>
                  </p>
                  <p className="font-mono text-[13px] text-paper">
                    {fill(copy.creditsLine, { credits: num(p.credits) })}
                  </p>
                </div>
                <ul className="flex flex-1 flex-col border-t border-line text-[15px] leading-[1.45] text-dim">
                  {!p.requiresCard ? <li className="border-b border-line py-2.5">{copy.noCard}</li> : null}
                  {p.historyDays !== null ? (
                    <li className="border-b border-line py-2.5">
                      {fill(copy.historyDays, { days: p.historyDays })}
                    </li>
                  ) : null}
                  {p.features.map((f) =>
                    copy.features[f] ? (
                      <li key={f} className="border-b border-line py-2.5">
                        {copy.features[f]}
                      </li>
                    ) : null,
                  )}
                </ul>
                {p.id === "free" || isCurrent ? null : live ? (
                  <Button
                    variant="secondary"
                    loading={busy === `change-${p.id}`}
                    onClick={() => startChange(p.id, interval)}
                    data-testid={`change-${p.id}`}
                  >
                    {fill(copy.checkout.subscribe, { plan: p.name })}
                  </Button>
                ) : (
                  <div className="flex flex-col gap-3">
                    <Button
                      variant={primaryPlan === p.id ? "primary" : "secondary"}
                      loading={busy === key}
                      onClick={() =>
                        go("/api/billing/checkout", { kind: "subscription", plan: p.id, interval }, key)
                      }
                      data-testid={`subscribe-${p.id}`}
                    >
                      {fill(copy.checkout.subscribe, { plan: p.name })}
                    </Button>
                    <p className="text-[15px] leading-[1.5] text-mute">
                      {fill(copy.checkout.notice, {
                        price: usd(price(p)),
                        per: interval === "year" ? "per year" : "per month",
                      })}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="topups-h" className="flex flex-col gap-6" id="topups">
        <div className="flex flex-col gap-2">
          <SectionTitle id="topups-h">{copy.topups.heading}</SectionTitle>
          <p className="text-[15px] text-dim">{copy.topups.body}</p>
        </div>
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[28rem] border-collapse text-left text-[15px]"
            data-testid="topup-table"
          >
            <thead>
              <tr className="border-b border-line">
                <th className="h-11 pr-4 font-mono text-[12px] font-normal text-mute">
                  {copy.topups.columns.pay}
                </th>
                <th className="h-11 px-4 font-mono text-[12px] font-normal text-mute">
                  {copy.topups.columns.credits}
                </th>
                <th className="h-11 px-4 font-mono text-[12px] font-normal text-mute">
                  {copy.topups.columns.bonus}
                </th>
                <th className="h-11 pl-4" />
              </tr>
            </thead>
            <tbody>
              {view.topups.map((t) => (
                <tr key={t.usd} className="border-b border-line transition-colors duration-300 hover:bg-bg-2">
                  <th
                    scope="row"
                    className="py-3 pr-4 font-mono text-[14px] font-normal text-paper tabular-nums"
                  >
                    {usd(t.usd)}
                  </th>
                  <td className="px-4 py-3 font-mono text-[14px] tabular-nums">{num(t.credits)}</td>
                  <td className="px-4 py-3 font-mono text-[13px] text-dim">
                    {t.bonusPct > 0 ? `+${t.bonusPct}%` : "-"}
                  </td>
                  <td className="py-3 pl-4 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy === `topup-${t.usd}`}
                      onClick={() =>
                        go("/api/billing/checkout", { kind: "topup", usd: t.usd }, `topup-${t.usd}`)
                      }
                      data-testid={`topup-${t.usd}`}
                    >
                      {fill(copy.topups.buy, { usd: usd(t.usd) })}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[15px] text-mute">
          {fill(copy.topups.expiry, { expiryMonths: TOPUP_EXPIRY_MONTHS })}
        </p>
      </section>

      <Dialog open={change !== null} onOpenChange={(o) => !o && setChange(null)}>
        <DialogContent>
          {change ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {fill(
                    change.preview.kind === "upgrade" ? copy.change.upgradeTitle : copy.change.downgradeTitle,
                    { plan: PLANS[change.plan].name },
                  )}
                </DialogTitle>
                <DialogDescription data-testid="change-body">
                  {change.preview.kind === "upgrade"
                    ? fill(copy.change.upgradeBody, {
                        amount:
                          change.preview.amountCents === null ? "" : centsToUsd(change.preview.amountCents),
                      })
                    : fill(copy.change.downgradeBody, { date: dateFmt(change.preview.effectiveAt) })}
                </DialogDescription>
              </DialogHeader>
              {change.preview.releasesFoundingSeat ? (
                <Notice role="alert" mark="!" data-testid="founding-warning">
                  <p>{fill(copy.change.foundingWarning, { price: usd(FOUNDING.monthlyUsd) })}</p>
                </Notice>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Not now</Button>
                </DialogClose>
                <Button loading={busy === "confirm"} onClick={confirmChange} data-testid="change-confirm">
                  {copy.change.confirm}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.subscription.cancel}</DialogTitle>
            <DialogDescription>{copy.subscription.cancelHelp}</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-2 text-[15px] text-dim">
            {copy.subscription.cancelReason}
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </label>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Keep my plan</Button>
            </DialogClose>
            <Button
              variant="secondary"
              loading={busy === "cancel"}
              onClick={cancel}
              data-testid="cancel-confirm"
            >
              {copy.subscription.cancel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
