"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tooltip,
} from "@voidaccess/ui";
import { UPGRADE_URL } from "@/lib/results/entity-style";
import { FORMAT_META, type ExportFormat, type ExportState } from "@/lib/results/formats";

export function ExportsView({ investigationId, states }: { investigationId: string; states: ExportState[] }) {
  const [upsell, setUpsell] = useState<ExportFormat | null>(null);
  return (
    <>
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {states.map((s) => {
          const meta = FORMAT_META[s.format];
          const href = `/api/investigations/${investigationId}/exports/${s.format}`;
          return (
            <li
              key={s.format}
              className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4"
              data-testid={`export-${s.format}`}
            >
              <div>
                <h3 className="font-display text-base font-semibold">{meta.label}</h3>
                <p className="mt-1 text-sm text-fg-secondary">{meta.description}</p>
              </div>
              <div className="mt-auto">
                {s.missing ? (
                  <Tooltip content="This run did not produce this artifact, so there is nothing to download.">
                    <span tabIndex={0} className="inline-block">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled
                        aria-label={`${meta.label} not available for this run`}
                      >
                        Not available
                      </Button>
                    </span>
                  </Tooltip>
                ) : s.locked ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setUpsell(s.format)}
                    aria-label={`${meta.label} is locked: upgrade to download`}
                  >
                    <span aria-hidden>🔒</span> Locked
                  </Button>
                ) : (
                  <a
                    href={href}
                    download
                    className="inline-flex h-8 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-fg-inverse hover:bg-accent/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Download {meta.label}
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-sm text-fg-secondary">
        Credentials and personal data are always masked in exports. Relationship edges are leads, not verified
        facts.
      </p>
      <Dialog open={upsell !== null} onOpenChange={(o) => !o && setUpsell(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upgrade to export {upsell ? FORMAT_META[upsell].label : ""}</DialogTitle>
            <DialogDescription>
              CSV and JSON exports are on every plan. Markdown, the IOC package, STIX, MISP and the
              detection-rule formats are included with Pro and Pro+.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Not now</Button>
            </DialogClose>
            <a
              href={UPGRADE_URL}
              data-testid="upgrade-link"
              className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-fg-inverse hover:bg-accent/85"
            >
              See plans
            </a>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
