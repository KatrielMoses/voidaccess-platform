"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@voidaccess/ui";

const TABS = [
  { slug: "summary", label: "Summary" },
  { slug: "graph", label: "Graph" },
  { slug: "entities", label: "Entities" },
  { slug: "actors", label: "Actors" },
  { slug: "sources", label: "Sources" },
  { slug: "exports", label: "Exports" },
] as const;

/** Each tab is its own route segment, so heavy code (the graph) only loads when its tab is opened. */
export function ResultsNav({
  id,
  counts,
}: {
  id: string;
  counts: { entities: number; actors: number; sources: number };
}) {
  const pathname = usePathname();
  const count: Record<string, number | undefined> = {
    entities: counts.entities,
    actors: counts.actors,
    sources: counts.sources,
  };
  return (
    <nav aria-label="Results sections" className="-mx-1 overflow-x-auto border-b border-line">
      <ul className="flex min-w-max items-center gap-7 px-1">
        {TABS.map((t) => {
          const href = `/investigations/${id}/results/${t.slug}`;
          const active = pathname === href;
          return (
            <li key={t.slug}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // the 1px underline draws from the left in 0.55s (design.md §6 navigation)
                  "relative flex items-baseline gap-2 py-3.5 text-[15px] text-dim transition-colors duration-300 hover:text-paper",
                  "after:absolute after:inset-x-0 after:-bottom-px after:h-px after:origin-right after:scale-x-0 after:bg-current after:transition-transform after:duration-[550ms] after:ease-out hover:after:origin-left hover:after:scale-x-100",
                  active && "text-paper after:origin-left after:scale-x-100",
                )}
              >
                {t.label}
                {count[t.slug] !== undefined ? (
                  <span className="font-mono text-[12px] text-mute tabular-nums">{count[t.slug]}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
