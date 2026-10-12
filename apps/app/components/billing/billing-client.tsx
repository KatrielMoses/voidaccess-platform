"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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

  return (
    <div className="flex flex-col gap-8">
      {checkout === "success" ? (
        <p
          role="status"
          className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
          data-testid="checkout-return"
        >
          Thanks! Your plan updates as soon as Dodo confirms the payment, usually within a minute.
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}

      {view.sub?.status === "past_due" ? (
        <p
          role="alert"
          className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
          data-testid="past-due"
        >
          {copy.subscription.pastDue}{" "}
          <button
            type="button"
            onClick={() => simple("/api/billing/portal")}
            className="underline underline-offset-2"
          >
            {copy.alerts.updatePayment}
          </button>
        </p>
      ) : null}

      {live ? (
        <Card data-testid="subscription-panel">
          <CardHeader>
            <CardTitle>{copy.subscription.heading}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>
              <span className="font-medium">{PLANS[view.sub!.plan].name}</span>
              {view.sub!.isFounding ? (
                <Badge variant="accent" className="ml-2">
                  Founding member
                </Badge>
              ) : null}{" "}
              <span className="text-fg-secondary">
                ({view.sub!.interval === "year" ? copy.annual : copy.monthly})
              </span>
            </p>
            <p className="text-fg-secondary" data-testid="renewal-line">
              {ending
                ? fill(copy.subscription.endsOn, { date: dateFmt(ending) })
                : fill(copy.subscription.renews, { date: dateFmt(view.sub!.currentPeriodEnd) })}
            </p>
            {view.sub!.pending ? (
              <p className="text-warning" data-testid="pending-line">
                {fill(copy.subscription.pendingDowngrade, {
                  plan: PLANS[view.sub!.pending.plan].name,
                  date: dateFmt(view.sub!.pending.at),
                })}{" "}
                <button
                  type="button"
                  onClick={() => simple("/api/billing/pending", "DELETE")}
                  className="underline underline-offset-2"
                >
                  Undo
                </button>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                loading={busy === "/api/billing/portal"}
                onClick={() => simple("/api/billing/portal")}
                data-testid="portal"
              >
                {copy.subscription.portal}
              </Button>
              {ending ? (
                <Button
                  size="sm"
                  loading={busy === "/api/billing/resume"}
                  onClick={() => simple("/api/billing/resume")}
                >
                  {copy.subscription.resume}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCancelOpen(true)}
                  data-testid="cancel-open"
                >
                  {copy.subscription.cancel}
                </Button>
              )}
            </div>
            <p className="text-xs text-fg-secondary">{copy.subscription.portalHelp}</p>
          </CardContent>
        </Card>
      ) : null}

      {view.founding.held ? (
        <Card className="border-accent-border" data-testid="founder-panel">
          <CardHeader>
            <CardTitle>{copy.founding.yourSeat}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <p>
              {copy.founding.termEnds}: <span className="font-medium">{dateFmt(view.founding.termEnd)}</span>
            </p>
            <p
              className={view.founding.status === "at_risk" ? "text-warning" : "text-success"}
              data-testid="founder-status"
            >
              {view.founding.status === "at_risk"
                ? `${copy.founding.status.at_risk}${view.founding.releasingOn ? ` (${dateFmt(view.founding.releasingOn)})` : ""}`
                : copy.founding.status.renews}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {view.canClaimFounding || (!view.sub && view.seats.available <= 0) ? (
        <section
          className="rounded-lg border border-accent-border bg-accent-dim p-5"
          data-testid="founding-banner"
          aria-labelledby="founding-h"
        >
          <h2 id="founding-h" className="font-display text-xl font-semibold">
            {fill(copy.founding.heading, { price: usd(FOUNDING.monthlyUsd) })}
          </h2>
          <p className="mt-1 text-sm text-fg-secondary">{FOUNDING.copy}</p>
          <p className="mt-3 font-mono text-sm" data-testid="seat-counter">
            {fill(copy.founding.counter, { available: view.seats.available, total: view.seats.total })}
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-fg-secondary">
            {copy.founding.rules.map((r) => (
              <li key={r}>
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
              </li>
            ))}
          </ul>
          {view.canClaimFounding ? (
            <div className="mt-4 flex flex-col items-start gap-2">
              <Button
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
              <p className="text-xs text-fg-secondary">
                {fill(copy.checkout.foundingNotice, { price: usd(FOUNDING.monthlyUsd), line: FOUNDING.copy })}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-warning">{copy.founding.soldOut}</p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="plans-h" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="plans-h" className="font-display text-xl font-semibold">
            {copy.title}
          </h2>
          <div
            role="group"
            aria-label="Billing period"
            className="inline-flex rounded-md border border-border-subtle p-0.5 text-sm"
          >
            {(["month", "year"] as const).map((iv) => (
              <button
                key={iv}
                type="button"
                aria-pressed={interval === iv}
                onClick={() => setInterval(iv)}
                data-testid={`interval-${iv}`}
                className={cn(
                  "rounded px-3 py-1.5 focus-visible:outline-2 focus-visible:outline-accent",
                  interval === iv ? "bg-accent text-fg-inverse" : "text-fg-secondary hover:text-fg",
                )}
              >
                {iv === "month" ? copy.monthly : copy.annual}
                {iv === "year" ? (
                  <span className="ml-1.5 text-xs opacity-80">
                    {fill(copy.annualNote, { monthsFree: monthsFree("pro") })}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
        <ul className="grid gap-4 md:grid-cols-3">
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
              <li key={p.id}>
                <Card
                  className={cn("h-full", isCurrent && "border-accent-border")}
                  data-testid={`plan-${p.id}`}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>{p.name}</CardTitle>
                      {isCurrent ? <Badge variant="accent">{copy.currentPlan}</Badge> : null}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    <p>
                      <span className="font-display text-3xl font-semibold">{usd(price(p))}</span>
                      <span className="text-sm text-fg-secondary">
                        {p.id === "free" ? copy.perMonth : interval === "year" ? copy.perYear : copy.perMonth}
                      </span>
                    </p>
                    <p className="font-mono text-sm text-accent">
                      {fill(copy.creditsLine, { credits: num(p.credits) })}
                    </p>
                    <ul className="flex-1 space-y-1.5 text-sm text-fg-secondary">
                      {!p.requiresCard ? <li>{copy.noCard}</li> : null}
                      {p.historyDays !== null ? (
                        <li>{fill(copy.historyDays, { days: p.historyDays })}</li>
                      ) : null}
                      {p.features.map((f) => (copy.features[f] ? <li key={f}>{copy.features[f]}</li> : null))}
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
                      <div className="flex flex-col gap-1.5">
                        <Button
                          loading={busy === key}
                          onClick={() =>
                            go("/api/billing/checkout", { kind: "subscription", plan: p.id, interval }, key)
                          }
                          data-testid={`subscribe-${p.id}`}
                        >
                          {fill(copy.checkout.subscribe, { plan: p.name })}
                        </Button>
                        <p className="text-xs text-fg-secondary">
                          {fill(copy.checkout.notice, {
                            price: usd(price(p)),
                            per: interval === "year" ? "per year" : "per month",
                          })}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="topups-h" className="flex flex-col gap-3" id="topups">
        <h2 id="topups-h" className="font-display text-xl font-semibold">
          {copy.topups.heading}
        </h2>
        <p className="text-sm text-fg-secondary">{copy.topups.body}</p>
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full min-w-[28rem] border-collapse text-left text-sm" data-testid="topup-table">
            <thead className="bg-surface text-xs uppercase text-fg-secondary">
              <tr>
                <th className="px-4 py-2">{copy.topups.columns.pay}</th>
                <th className="px-4 py-2">{copy.topups.columns.credits}</th>
                <th className="px-4 py-2">{copy.topups.columns.bonus}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-dim">
              {view.topups.map((t) => (
                <tr key={t.usd}>
                  <th scope="row" className="px-4 py-2 font-mono">
                    {usd(t.usd)}
                  </th>
                  <td className="px-4 py-2 font-mono">{num(t.credits)}</td>
                  <td className="px-4 py-2 text-fg-secondary">{t.bonusPct > 0 ? `+${t.bonusPct}%` : "-"}</td>
                  <td className="px-4 py-2 text-right">
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
        <p className="text-xs text-fg-secondary">
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
                <p
                  role="alert"
                  className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
                  data-testid="founding-warning"
                >
                  {fill(copy.change.foundingWarning, { price: usd(FOUNDING.monthlyUsd) })}
                </p>
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
          <label className="flex flex-col gap-1.5 text-sm">
            {copy.subscription.cancelReason}
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </label>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Keep my plan</Button>
            </DialogClose>
            <Button
              variant="danger"
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
