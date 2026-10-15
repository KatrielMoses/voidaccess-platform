"use client";

import Link from "next/link";
import { useState } from "react";
import { TOPUPS } from "@voidaccess/config";
import { Button } from "@voidaccess/ui";
import { billingCopy as copy, fill } from "@/content/billing";
import { num, usd } from "@/lib/billing/format";
import { Notice } from "@/components/page-header";

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
    <Notice role="alert" mark="!" data-testid="out-of-credits">
      <p className="font-medium">
        {copy.outOfCredits.title}.{" "}
        <span className="font-normal text-dim">
          {fill(copy.outOfCredits.body, { needed: num(needed), balance: num(balance) })}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button size="sm" variant="secondary" loading={busy} onClick={buy} data-testid="out-of-credits-topup">
          {fill(copy.outOfCredits.cheapest, { usd: usd(tier.usd) })}
        </Button>
        <Link href="/billing?from=out_of_credits" className="va-link" data-testid="out-of-credits-upgrade">
          {copy.outOfCredits.upgrade}
        </Link>
      </div>
      {failed ? (
        <p className="text-paper">
          <span aria-hidden className="font-mono text-[12px]">
            ✕{" "}
          </span>
          Couldn&apos;t start checkout. Try again from the billing page.
        </p>
      ) : null}
    </Notice>
  );
}
