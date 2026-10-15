"use client";

import { useState } from "react";
import { formatDate } from "@/lib/results/format";
import type { ActorView } from "@/lib/results/types";
import { Contour } from "./contour";
import { SideDrawer } from "./side-drawer";
import { TypeBadge } from "./type-badge";
import { H, RULED, UL, VALUE_LINK } from "./ui";

/** Actor cards follow the design's entity card: index, mono type label, contour drawing, name, mono value. */
export function ActorsView({ actors, investigationId }: { actors: ActorView[]; investigationId: string }) {
  const [open, setOpen] = useState<ActorView | null>(null);
  if (actors.length === 0) return <p className="text-dim">No actors were identified in this run.</p>;
  return (
    <>
      <ul className="grid gap-px border border-line bg-line md:grid-cols-2 lg:grid-cols-3">
        {actors.map((a, i) => (
          <li key={a.bundleId} className="flex">
            <article
              className="group relative flex w-full flex-col overflow-hidden bg-bg px-6 pt-6 pb-6 transition-colors duration-[600ms] ease-out hover:bg-bg-2 focus-within:bg-bg-2 sm:px-7 sm:pt-7"
              data-testid="actor-card"
            >
              <Contour
                seed={a.handle}
                className="pointer-events-none absolute top-6 -right-8 h-[130px] w-[176px] opacity-80 sm:h-[150px] sm:w-[204px]"
              />
              <div className="relative flex items-baseline gap-4 font-mono">
                <span className="text-[13px] text-dim tabular-nums transition-colors duration-300 group-hover:text-paper">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[12px] text-mute">actor</span>
              </div>
              <h3 className="relative mt-20 text-[23px] leading-[1.12] font-medium tracking-[-0.03em] break-words sm:mt-24 sm:text-[27px]">
                {a.handle}
              </h3>
              <p className="relative mt-3 font-mono text-[15px] text-paper tabular-nums transition-colors duration-300 group-hover:text-v-200">
                {a.entityCount} linked entities
              </p>
              <p className="relative mt-2 font-mono text-[12px] text-mute tabular-nums">
                {formatDate(a.firstSeen)} to {formatDate(a.lastSeen)}
              </p>
              {a.aliases.length > 0 ? (
                <p className="relative mt-4 text-[14px] text-dim">
                  Also seen as: <span className="text-paper">{a.aliases.join(", ")}</span>
                </p>
              ) : null}
              {a.summary ? (
                <p className="relative mt-3 line-clamp-3 text-[14px] text-dim">{a.summary}</p>
              ) : null}
              <button
                type="button"
                className={`${UL} relative mt-6 self-start pt-0 text-[14px]`}
                onClick={() => setOpen(a)}
              >
                Details <span aria-hidden>→</span>
              </button>
            </article>
          </li>
        ))}
      </ul>
      <SideDrawer open={open !== null} onClose={() => setOpen(null)} title={open?.handle ?? ""}>
        {open ? (
          <div className="flex flex-col gap-7 text-[14px]">
            {open.summary ? <p className="text-[15px] leading-relaxed text-dim">{open.summary}</p> : null}
            <section className="flex flex-col gap-3">
              <h3 className={H}>
                Linked entities{" "}
                <span className="font-mono text-[12px] text-mute tabular-nums">{open.entities.length}</span>
              </h3>
              <ul className={RULED}>
                {open.entities.map((e) => (
                  <li key={e.bundleId} className="flex items-center justify-between gap-3 py-2">
                    <a
                      href={`/investigations/${investigationId}/results/entities?focus=${encodeURIComponent(e.bundleId)}`}
                      className={VALUE_LINK}
                    >
                      {e.displayValue}
                    </a>
                    <TypeBadge type={e.type} className="shrink-0" />
                  </li>
                ))}
              </ul>
            </section>
            <section className="flex flex-col gap-3">
              <h3 className={H}>
                Sources{" "}
                <span className="font-mono text-[12px] text-mute tabular-nums">{open.sources.length}</span>
              </h3>
              <ul className={RULED}>
                {open.sources.map((s) => (
                  <li key={s.bundleId} className="py-2 text-dim">
                    {s.name}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
      </SideDrawer>
    </>
  );
}
