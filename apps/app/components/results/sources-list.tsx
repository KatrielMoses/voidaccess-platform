"use client";

import { useMemo, useState } from "react";
import { Badge, Input } from "@voidaccess/ui";
import type { SourceView } from "@/lib/results/types";
import { formatDate } from "@/lib/results/format";
import { CopyOnlyUrl } from "./copy-text";

const KIND_LABEL: Record<string, string> = {
  tor_search: "Tor search",
  onion_page: "Onion page",
  paste: "Paste site",
  code_forge: "Code forge",
  feed: "Security feed",
  enrichment: "Enrichment",
};

/** Excerpts and URLs are plain text: no HTML rendering, no links, nothing is fetched. */
export function SourcesList({ sources }: { sources: SourceView[] }) {
  const [kind, setKind] = useState<string>("all");
  const [q, setQ] = useState("");
  const kinds = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of sources) c.set(s.kind, (c.get(s.kind) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]);
  }, [sources]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sources.filter(
      (s) =>
        (kind === "all" || s.kind === kind) &&
        (!term || s.excerpt.toLowerCase().includes(term) || s.name.toLowerCase().includes(term)),
    );
  }, [sources, kind, q]);
  const groups = useMemo(() => {
    const m = new Map<string, SourceView[]>();
    for (const s of filtered) m.set(s.kind, [...(m.get(s.kind) ?? []), s]);
    return [...m];
  }, [filtered]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search source excerpts"
          placeholder="Search excerpts…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by kind">
          {[["all", sources.length] as const, ...kinds].map(([k, n]) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-full border px-3 py-1 text-xs focus-visible:outline-2 focus-visible:outline-accent ${kind === k ? "border-accent-border bg-accent-dim text-accent" : "border-border-subtle text-fg-secondary hover:text-fg"}`}
            >
              {k === "all" ? "All" : (KIND_LABEL[k] ?? k)} <span className="font-mono">{n}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-fg-secondary" aria-live="polite">
        {filtered.length} of {sources.length} sources. Excerpts are text only; no pages, images or media are
        loaded.
      </p>
      {groups.map(([k, list]) => (
        <section key={k} aria-labelledby={`kind-${k}`} className="flex flex-col gap-3">
          <h2 id={`kind-${k}`} className="font-display text-lg font-semibold">
            {KIND_LABEL[k] ?? k} <span className="font-mono text-sm text-fg-secondary">{list.length}</span>
          </h2>
          <ul className="flex flex-col gap-3">
            {list.map((s) => (
              <li
                key={s.bundleId}
                className="rounded-lg border border-border-subtle bg-surface p-4"
                data-testid="source-item"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{s.name}</span>
                  <Badge variant="neutral">{formatDate(s.fetchedAt, true)}</Badge>
                </div>
                {s.excerpt ? (
                  <p className="mt-2 text-sm whitespace-pre-wrap text-fg-secondary">{s.excerpt}</p>
                ) : (
                  <p className="mt-2 text-sm text-fg-muted">No excerpt kept.</p>
                )}
                {s.url ? (
                  <div className="mt-3">
                    <CopyOnlyUrl url={s.url} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
