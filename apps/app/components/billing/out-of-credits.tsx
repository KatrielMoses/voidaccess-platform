"use client";

import Link from "next/link";
import { useState } from "react";
import { TOPUPS } from "@voidaccess/config";
import { Button } from "@voidaccess/ui";
import { billingCopy as copy, fill } from "@/content/billing";
import { num, usd } from "@/lib/billing/format";

/** Replaces the plain insufficient-credits message: the cheapest top-up that covers the shortfall, plus an upgrade link. */
export function OutOfCredits({ balance, needed }: { balance: number; needed: number }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const shortfall = Math.max(0, needed - balance);
  const tier = TOPUPS.find((t) => t.credits >= shortfall) ?? TOPUPS[TOPUPS.length - 1]!;

  async function buy() {
    setBusy(true);
    setFailed(false);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "topup", usd: tier.usd }),
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string };
    if (res.ok && body.url) window.location.href = body.url;
    else {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div
      role="alert"
      data-testid="out-of-credits"
      className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-3 text-sm text-warning"
    >
      <p className="font-medium">
        {copy.outOfCredits.title}.{" "}
        {fill(copy.outOfCredits.body, { needed: num(needed), balance: num(balance) })}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" loading={busy} onClick={buy} data-testid="out-of-credits-topup">
          {fill(copy.outOfCredits.cheapest, { usd: usd(tier.usd) })}
        </Button>
        <Link
          href="/billing?from=out_of_credits"
          className="underline underline-offset-2"
          data-testid="out-of-credits-upgrade"
        >
          {copy.outOfCredits.upgrade}
        </Link>
      </div>
      {failed ? (
        <p className="text-danger">Couldn&apos;t start checkout. Try again from the billing page.</p>
      ) : null}
    </div>
  );
}
