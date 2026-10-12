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
    <nav aria-label="Results sections" className="-mx-1 overflow-x-auto border-b border-border-subtle">
      <ul className="flex min-w-max items-center gap-1 px-1">
        {TABS.map((t) => {
          const href = `/investigations/${id}/results/${t.slug}`;
          const active = pathname === href;
          return (
            <li key={t.slug}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px flex items-center gap-2 border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-fg-secondary transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-accent",
                  active && "border-accent text-fg",
                )}
              >
                {t.label}
                {count[t.slug] !== undefined ? (
                  <span className="rounded-full bg-raised px-1.5 text-xs text-fg-secondary">
                    {count[t.slug]}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
