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
import { FORMAT_META, exportFilename, type ExportFormat, type ExportState } from "@/lib/results/formats";

/** The secondary label of each cell: its category, switching to the file name on hover (design.md §6). */
const CATEGORY: Record<ExportFormat, string> = {
  csv: "tables",
  json: "raw",
  markdown: "report",
  ioc: "indicators",
  stix: "sharing",
  misp: "events",
  sigma: "detection",
  yara: "patterns",
  snort: "network",
  suricata: "network",
};

/**
 * The exports field: the view's one violet thing. Cells are separated by paper hairlines; on hover a v-700 fill
 * rises from the bottom and the category label becomes the file name. Buttons on this view are paper, never violet.
 */
export function ExportsView({ investigationId, states }: { investigationId: string; states: ExportState[] }) {
  const [upsell, setUpsell] = useState<ExportFormat | null>(null);
  return (
    <>
      <section aria-labelledby="exports-h" className="overflow-hidden rounded-lg bg-v-600 text-paper">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-2 px-6 pt-8 pb-7 sm:px-8">
          <h2 id="exports-h" className="text-[26px] leading-tight font-medium tracking-[-0.03em]">
            Take it with you
          </h2>
          <p className="max-w-[44ch] text-[14px] text-v-100">
            CSV and JSON are on every plan. Credentials and personal data are always masked in exports.
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-px border-t border-paper/30 bg-paper/20 md:grid-cols-5">
          {states.map((s) => {
            const meta = FORMAT_META[s.format];
            const href = `/api/investigations/${investigationId}/exports/${s.format}`;
            const file = exportFilename(investigationId, s.format);
            const body = (state: string) => (
              <>
                <span
                  aria-hidden
                  className="absolute inset-0 origin-bottom scale-y-0 bg-v-700 transition-transform duration-700 ease-out group-hover:scale-y-100 group-focus-visible:scale-y-100 motion-reduce:transition-none"
                />
                <span className="relative block text-[19px] leading-[1.15] font-medium tracking-[-0.02em] sm:text-[21px]">
                  {meta.label}
                </span>
                <span className="relative mt-2 block text-[13px] leading-snug text-v-100">
                  {meta.description}
                </span>
                <span className="relative mt-auto grid pt-5 font-mono text-[12px] leading-none text-v-100">
                  <span className="col-start-1 row-start-1 truncate transition-opacity duration-200 group-hover:opacity-0 group-focus-visible:opacity-0">
                    {CATEGORY[s.format]}
                  </span>
                  <span className="col-start-1 row-start-1 truncate text-paper opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                    {file}
                  </span>
                </span>
                <span className="relative mt-3 block text-[14px] font-medium">{state}</span>
              </>
            );
            const cell =
              "group relative flex h-full min-h-[13rem] w-full flex-col p-5 text-left outline-offset-[-6px] sm:p-6";
            return (
              <li key={s.format} className="bg-v-600" data-testid={`export-${s.format}`}>
                {s.missing ? (
                  <Tooltip content="This run did not produce this artifact, so there is nothing to download.">
                    <span tabIndex={0} className="block h-full">
                      <button
                        type="button"
                        disabled
                        aria-label={`${meta.label} not available for this run`}
                        className={`${cell} cursor-not-allowed [&>span]:opacity-60`}
                      >
                        {body("Not in this run")}
                      </button>
                    </span>
                  </Tooltip>
                ) : s.locked ? (
                  <button
                    type="button"
                    onClick={() => setUpsell(s.format)}
                    aria-label={`${meta.label} is locked: upgrade to download`}
                    className={cell}
                  >
                    {body("Locked · upgrade to download")}
                  </button>
                ) : (
                  <a href={href} download className={cell}>
                    {body("Download ↓")}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <p className="mt-5 text-[14px] text-dim">Relationship edges are leads, not verified facts.</p>
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
              className="inline-flex h-10 items-center rounded-sm bg-paper px-5 text-[15px] font-medium text-ink transition-colors duration-300 hover:bg-white"
            >
              See plans
            </a>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
