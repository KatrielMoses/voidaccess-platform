"use client";

import { useMemo, useState } from "react";
import { Input } from "@voidaccess/ui";
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
    <div className="flex flex-col gap-6">
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
              className={`flex h-8 items-center gap-2 rounded-sm border px-2.5 text-[13px] transition-colors duration-300 ${kind === k ? "border-line-3 bg-paper/[0.06] text-paper" : "border-line text-dim hover:border-line-2 hover:text-paper"}`}
            >
              {k === "all" ? "All" : (KIND_LABEL[k] ?? k)}{" "}
              <span className="font-mono text-[12px] text-mute tabular-nums">{n}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-[14px] text-dim" aria-live="polite">
        {filtered.length} of {sources.length} sources. Excerpts are text only; no pages, images or media are
        loaded.
      </p>
      {groups.map(([k, list]) => (
        <section key={k} aria-labelledby={`kind-${k}`} className="flex flex-col gap-3">
          <h2
            id={`kind-${k}`}
            className="flex items-baseline gap-3 text-[22px] leading-tight font-medium tracking-[-0.02em]"
          >
            {KIND_LABEL[k] ?? k}{" "}
            <span className="font-mono text-[13px] font-normal tracking-normal text-mute tabular-nums">
              {list.length}
            </span>
          </h2>
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {list.map((s) => (
              <li
                key={s.bundleId}
                className="grid gap-x-8 gap-y-2 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
                data-testid="source-item"
              >
                <div className="flex flex-col gap-1.5">
                  <span className="text-[15px] font-medium text-paper">{s.name}</span>
                  <span className="font-mono text-[12px] text-mute tabular-nums">
                    {formatDate(s.fetchedAt, true)}
                  </span>
                </div>
                <div className="min-w-0">
                  {s.excerpt ? (
                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-dim">{s.excerpt}</p>
                  ) : (
                    <p className="font-mono text-[12px] text-mute">No excerpt kept.</p>
                  )}
                  {s.url ? (
                    <div className="mt-3">
                      <CopyOnlyUrl url={s.url} />
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
