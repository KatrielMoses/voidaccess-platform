"use client";

import { useState } from "react";
import { Button, cn } from "@voidaccess/ui";
import { fillPreview, previewCopy as copy } from "@/content/preview";
import {
  countsPhrase,
  priceLabel,
  safeReturnPath,
  chooseUnlockOffer,
  type UnlockOffer,
} from "@/lib/preview/offer";
import type { PreviewTotals } from "@/lib/preview/types";
import { SITE_URL, SUPPORT_EMAIL } from "@/lib/site";
import { sendPreviewEvent, writePending } from "./client-events";

export const PRICING_URL = `${SITE_URL}/pricing`;

/** Where the checkout comes back to: this report page, or its summary when the current path isn't a report path. */
export function returnPathFor(investigationId: string): string {
  const here = typeof window !== "undefined" ? safeReturnPath(window.location.pathname) : null;
  return here && here.startsWith(`/investigations/${investigationId.toLowerCase()}`)
    ? here
    : `/investigations/${investigationId}/results/summary`;
}

/** The fallback line, with the support address as a mail link. Used in the panel and, prominently, after a failure. */
export function FallbackLine({ className }: { className?: string }) {
  const [before, after] = copy.panel.fallback.split("{email}");
  return (
    <p className={cn("text-[14px] leading-[1.55] text-dim", className)} data-testid="unlock-fallback">
      {before}
      <a href={`mailto:${SUPPORT_EMAIL}`} className="va-link text-paper">
        {SUPPORT_EMAIL}
      </a>
      {after}
    </p>
  );
}

/**
 * The unlock panel. Copy is fixed (content/preview.ts); only the counts and the price are filled. The price is one
 * we actually charge: the founding price while a seat is free for this user, otherwise Pro monthly.
 */
export function UnlockPanel({
  investigationId,
  totals,
  offer: initialOffer,
  origin = "panel",
  failed = false,
  className,
}: {
  investigationId: string;
  totals: PreviewTotals;
  offer: UnlockOffer;
  /** where the panel was opened from, for unlock_clicked */
  origin?: string;
  /** a checkout from this panel came back unpaid: the fallback line moves up and reads louder */
  failed?: boolean;
  className?: string;
}) {
  const [offer, setOffer] = useState(initialOffer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);
  const price = priceLabel(offer.priceUsd);
  const counts = countsPhrase(totals);

  const unlock = async () => {
    setBusy(true);
    setError(null);
    sendPreviewEvent({ name: "unlock_clicked", investigationId, origin, founding: offer.founding });
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "subscription",
          plan: "pro",
          interval: "month",
          founding: offer.founding,
          source: "preview_unlock",
          returnTo: returnPathFor(investigationId),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; ref?: string; error?: string };
      if (res.ok && data.url && data.ref) {
        writePending({ ref: data.ref, investigationId, at: Date.now() });
        window.location.assign(data.url);
        return;
      }
      if (data.error === "founding_unavailable" && offer.founding) {
        // the last seat went between page load and click: show the price we'd now charge, never charge it unseen
        setOffer(chooseUnlockOffer({ seatsAvailable: 0, holdsSeat: false, hasSubscription: false }));
        setError(null);
      } else if (data.error === "already_subscribed") {
        setError(
          <>
            {copy.errors.alreadySubscribed}{" "}
            <a href="/billing" className="va-link">
              Billing
            </a>
          </>,
        );
      } else {
        sendPreviewEvent({ name: "checkout_failed", investigationId, reason: "start_failed" });
        setError(fillPreview(copy.errors.generic, { email: SUPPORT_EMAIL }));
      }
    } catch {
      sendPreviewEvent({ name: "checkout_failed", investigationId, reason: "start_failed" });
      setError(fillPreview(copy.errors.generic, { email: SUPPORT_EMAIL }));
    }
    setBusy(false);
  };

  return (
    <section
      aria-labelledby={`unlock-h-${origin}`}
      data-testid="unlock-panel"
      className={cn(
        "flex w-full max-w-[34rem] flex-col gap-4 rounded-lg border border-line-2 bg-bg-2 px-6 py-6 text-left sm:px-7",
        className,
      )}
    >
      {failed ? <FallbackLine className="text-[15px] text-paper" /> : null}
      <h2
        id={`unlock-h-${origin}`}
        className="text-[19px] leading-snug font-medium tracking-[-0.02em] text-paper"
        data-testid="unlock-ready"
      >
        {counts ? fillPreview(copy.panel.ready, { counts }) : copy.panel.readyNoCounts}
      </h2>
      <p className="text-[15px] leading-[1.55] text-dim">{copy.panel.why}</p>
      <p className="text-[15px] leading-[1.55] text-paper" data-testid="unlock-price">
        {fillPreview(copy.panel.price, { price })}
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-1">
        <Button onClick={unlock} loading={busy} data-testid="unlock-button">
          {fillPreview(copy.panel.cta, { price })}
        </Button>
        <a href={PRICING_URL} className="va-link text-[15px]" data-testid="unlock-plans">
          {copy.panel.plans}
        </a>
      </div>
      {error ? (
        <p role="alert" className="text-[14px] text-paper">
          {error}
        </p>
      ) : null}
      {failed ? null : <FallbackLine />}
    </section>
  );
}
