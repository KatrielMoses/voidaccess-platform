"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@voidaccess/ui";
import { chooseUnlockOffer, type UnlockOffer } from "@/lib/preview/offer";
import { isPreview, type AccessView, type PreviewTotals } from "@/lib/preview/types";
import { firstInSession, sendPreviewEvent } from "./client-events";
import { UnlockPanel } from "./unlock-panel";

export interface PreviewState {
  investigationId: string;
  /** the server marked this report as a preview */
  preview: boolean;
  /** full counts (the marker's totals, or the summary's counts when a 402 arrives without a marker) */
  totals: PreviewTotals;
  offer: UnlockOffer;
  /** a panel checkout came back unpaid */
  failed: boolean;
  setFailed: (v: boolean) => void;
  /** opens the unlock panel as a dialog (graph node, export, entity detail, a 402 from any fetch) */
  openUnlock: (origin: string) => void;
}

const FULL: PreviewState = {
  investigationId: "",
  preview: false,
  totals: { sources: 0, entities: 0, byType: {}, actors: 0, onions: 0, iocs: 0, relationships: 0 },
  offer: chooseUnlockOffer({ seatsAvailable: 0, holdsSeat: false, hasSubscription: false }),
  failed: false,
  setFailed: () => undefined,
  openUnlock: () => undefined,
};

const Ctx = createContext<PreviewState>(FULL);

/** The results views read this; outside a provider every report is full and nothing is locked. */
export const usePreview = () => useContext(Ctx);

export function PreviewProvider({
  investigationId,
  access,
  fallbackTotals,
  offer,
  children,
}: {
  investigationId: string;
  access: AccessView | null;
  fallbackTotals: PreviewTotals;
  /** null for paid plans (they never see the panel); a stray 402 then shows Pro's standard price */
  offer: UnlockOffer | null;
  children: React.ReactNode;
}) {
  const preview = isPreview(access);
  const totals = preview ? access.totals : fallbackTotals;
  const [dialog, setDialog] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const openUnlock = useCallback((origin: string) => setDialog(origin), []);
  const resolvedOffer = useMemo(
    () => offer ?? chooseUnlockOffer({ seatsAvailable: 0, holdsSeat: false, hasSubscription: false }),
    [offer],
  );

  // preview_shown: once per report per browser session (emitted from the client; the server can't tell views apart)
  useEffect(() => {
    if (!preview || !firstInSession(`va:preview-shown:${investigationId}`)) return;
    sendPreviewEvent({
      name: "preview_shown",
      investigationId,
      sources: totals.sources,
      entities: totals.entities,
      actors: totals.actors,
    });
  }, [preview, investigationId, totals.sources, totals.entities, totals.actors]);

  const value = useMemo<PreviewState>(
    () => ({ investigationId, preview, totals, offer: resolvedOffer, failed, setFailed, openUnlock }),
    [investigationId, preview, totals, resolvedOffer, failed, openUnlock],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-[560px]" data-testid="unlock-dialog">
          <DialogTitle className="sr-only">Unlock the full report</DialogTitle>
          <DialogDescription className="sr-only">
            This part of the report is in the full report, which comes with Pro.
          </DialogDescription>
          <UnlockPanel
            investigationId={investigationId}
            totals={totals}
            offer={resolvedOffer}
            origin={dialog ?? "panel"}
            failed={failed}
            className="max-w-none border-0 bg-transparent p-0 pr-8 sm:px-0 sm:pr-8"
          />
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}
