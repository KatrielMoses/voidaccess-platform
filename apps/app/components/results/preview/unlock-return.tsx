"use client";

import { useCallback, useEffect, useState } from "react";
import { Notice } from "@/components/page-header";
import { fillPreview, previewCopy as copy } from "@/content/preview";
import { SUPPORT_EMAIL } from "@/lib/site";
import {
  clearPending,
  failureReason,
  readPending,
  sendPreviewEvent,
  type UnlockStatus as Status,
} from "./client-events";
import { usePreview } from "./preview-context";
import { FallbackLine } from "./unlock-panel";

const POLL_MS = 2_000;
const TIMEOUT_MS = 60_000;
async function fetchStatus(ref: string, probe: boolean): Promise<Status | null> {
  try {
    const r = await fetch(
      `/api/billing/checkout/status?ref=${encodeURIComponent(ref)}${probe ? "&probe=1" : ""}`,
      {
        cache: "no-store",
      },
    );
    return r.ok ? ((await r.json()) as Status) : null;
  } catch {
    return null;
  }
}

type View = { k: "idle" } | { k: "unlocking"; slow: boolean } | { k: "done" } | { k: "failed" };

/**
 * After a checkout from the unlock panel. Creem only redirects on success (to `?unlock=<ref>`), so:
 *  - with `?unlock=`: show "Unlocking…" and poll until the webhook has applied the plan, then reload; after ~60 s say
 *    to refresh or contact support (or, if Creem says the checkout never completed, treat it as failed);
 *  - without it, but with a pending checkout in this tab (the browser came back from Creem with Back): ask Creem for
 *    the checkout's status; anything but completed is a failed checkout.
 */
export function UnlockReturn({ investigationId }: { investigationId: string }) {
  const { setFailed } = usePreview();
  const [view, setView] = useState<View>({ k: "idle" });

  const fail = useCallback(
    (ref: string, s: Status | null, ageMs: number) => {
      sendPreviewEvent({
        name: "checkout_failed",
        investigationId,
        reason: failureReason(s, ageMs),
        providerStatus: s?.provider ?? undefined,
        checkoutRef: ref,
      });
      setFailed(true);
      setView({ k: "failed" });
    },
    [investigationId, setFailed],
  );

  const poll = useCallback(
    (ref: string, since: number) => {
      setView({ k: "unlocking", slow: false });
      let stopped = false;
      const tick = async () => {
        if (stopped) return;
        const s = await fetchStatus(ref, false);
        if (s?.paidPlan) {
          stopped = true;
          setView({ k: "done" });
          // drop ?unlock= and reload: the server now sends the full report
          window.location.replace(window.location.pathname);
          return;
        }
        if (Date.now() - since >= TIMEOUT_MS) {
          stopped = true;
          const probe = await fetchStatus(ref, true);
          if (
            probe &&
            !probe.completed &&
            probe.provider !== null &&
            probe.provider !== "completed" &&
            probe.provider !== "processing"
          )
            fail(ref, probe, Date.now() - since);
          else setView({ k: "unlocking", slow: true });
          return;
        }
        setTimeout(tick, POLL_MS);
      };
      void tick();
      return () => {
        stopped = true;
      };
    },
    [fail],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const ref = url.searchParams.get("unlock");
    const pending = readPending();
    if (ref) {
      clearPending();
      return poll(ref, Date.now());
    }
    const check = async () => {
      const p = readPending();
      if (!p || p.investigationId.toLowerCase() !== investigationId.toLowerCase()) return;
      clearPending();
      const s = await fetchStatus(p.ref, true);
      if (!s) return;
      if (s.paidPlan) return; // already unlocked
      if (s.completed || s.provider === "completed" || s.provider === "processing")
        return void poll(p.ref, Date.now());
      fail(p.ref, s, Date.now() - p.at);
    };
    if (pending) void check();
    // Back from Creem may restore this page from the back/forward cache without re-running effects
    const onShow = (e: PageTransitionEvent) => e.persisted && void check();
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [investigationId, poll, fail]);

  if (view.k === "idle") return null;
  if (view.k === "failed")
    return (
      <Notice role="alert" mark="!" data-testid="unlock-failed">
        <p className="font-medium text-paper">{copy.failed.title}</p>
        <p className="text-dim">{copy.failed.body}</p>
        <FallbackLine className="text-[15px] text-paper" />
      </Notice>
    );
  return (
    <Notice role="status" mark={view.k === "done" ? "✓" : "…"} tone="quiet" data-testid="unlock-status">
      <p className="font-medium text-paper">
        {view.k === "done" ? copy.unlocking.done : copy.unlocking.title}
      </p>
      {view.k === "unlocking" ? (
        <p>{view.slow ? fillPreview(copy.unlocking.slow, { email: SUPPORT_EMAIL }) : copy.unlocking.body}</p>
      ) : null}
    </Notice>
  );
}
