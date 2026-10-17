"use client";
import { cn } from "@voidaccess/ui";
import { TypeGlyph } from "@/components/results/type-glyph";
import { typeLabel as entityTypeLabel } from "@/lib/results/entity-style";
import {
  TRAY_LABEL,
  formatBytes,
  outcomeLabel,
  type LiveModel,
  type TrayBucket,
  type UrlTrail,
} from "@/lib/live/model";

export type Selection = { kind: "url" | "entity"; id: string } | { kind: "bucket"; id: TrayBucket } | null;

/** "removed by the safety filter" stands in for a host that must never be shown. */
export function hostText(u: UrlTrail | undefined): string {
  if (!u) return "unknown page";
  if (u.safety || !u.host) return "removed by the safety filter";
  return u.host;
}

function Row({ index, label, children }: { index: string; label: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[32px_88px_1fr] items-baseline gap-x-3 border-b border-line py-3 max-[960px]:grid-cols-[28px_72px_1fr]">
      <span className="font-mono text-[12px] text-mute tabular-nums">{index}</span>
      <span className="font-mono text-[12px] text-dim">{label}</span>
      <span className="min-w-0 font-mono text-[13px] leading-[1.5] break-words text-paper">{children}</span>
    </li>
  );
}

function UrlTrailView({
  model,
  u,
  onSelect,
}: {
  model: LiveModel;
  u: UrlTrail;
  onSelect: (s: Selection) => void;
}) {
  if (u.safety)
    return (
      <ol className="flex flex-col border-t border-line" data-testid="trail-safety">
        <Row index="01" label="Found">
          {hostText(u)}
        </Row>
        <Row index="02" label="Removed">
          The content-safety filter removed this page. No details are kept.
        </Row>
      </ol>
    );
  const ents = u.entityIds.map((id) => model.entities.get(id)).filter((e) => !!e);
  const filter =
    u.state === "dropped" && u.dropReason ? (
      <Row index="02" label="Dropped">
        {TRAY_LABEL[u.dropReason]}
      </Row>
    ) : u.state === "found" ? (
      <Row index="02" label="Filter">
        waiting
      </Row>
    ) : (
      <Row index="02" label="Kept">
        {u.score !== undefined ? `relevance ${u.score.toFixed(2)}` : "kept"}
      </Row>
    );
  const f = u.fetch;
  return (
    <ol className="flex flex-col border-t border-line">
      <Row index="01" label="Found">
        {u.host}
        <span className="text-dim">
          {u.engine ? ` · by ${u.engine}` : ""}
          {u.depth ? ` · crawled, depth ${u.depth}` : ""}
        </span>
      </Row>
      {filter}
      {f ? (
        <Row index="03" label={f.outcome === "ok" ? "Read" : "Fetch"}>
          {outcomeLabel(f.outcome)}
          <span className="text-dim">
            {f.httpStatus ? ` · HTTP ${f.httpStatus}` : ""}
            {formatBytes(f.bytes) ? ` · ${formatBytes(f.bytes)}` : ""}
            {f.ms !== undefined ? ` · ${(f.ms / 1000).toFixed(1)} s` : ""}
          </span>
        </Row>
      ) : null}
      {ents.length > 0 || u.byType ? (
        <Row index="04" label="Entities">
          <span className="flex flex-col gap-1.5">
            {u.byType ? (
              <span className="text-dim">
                {Object.entries(u.byType)
                  .map(([t, n]) => `${entityTypeLabel(t)} ${n}`)
                  .join(" · ")}
              </span>
            ) : null}
            {ents.slice(0, 12).map((e) => (
              <button
                key={e.id}
                type="button"
                className="flex items-center gap-2 text-left hover:text-v-200"
                onClick={() => onSelect({ kind: "entity", id: e.id })}
              >
                <TypeGlyph type={e.type} />
                {e.display}
              </button>
            ))}
          </span>
        </Row>
      ) : null}
    </ol>
  );
}

/** The trail of one mark: found by which engine -> kept or dropped -> fetch outcome -> entities. */
export function TrailPanel({
  model,
  selection,
  onSelect,
}: {
  model: LiveModel;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  let title = "Trail";
  let body: React.ReactNode = null;
  if (selection?.kind === "url") {
    const u = model.urls.get(selection.id);
    title = u ? hostText(u) : "Trail";
    body = u ? <UrlTrailView model={model} u={u} onSelect={onSelect} /> : null;
  } else if (selection?.kind === "entity") {
    const e = model.entities.get(selection.id);
    if (e) {
      const u = e.urlId ? model.urls.get(e.urlId) : undefined;
      title = e.display;
      body = (
        <ol className="flex flex-col border-t border-line">
          <Row index="01" label="Type">
            <span className="inline-flex items-center gap-2">
              <TypeGlyph type={e.type} />
              {entityTypeLabel(e.type)}
            </span>
          </Row>
          {e.confidence !== undefined ? (
            <Row index="02" label="Confidence">
              {e.confidence.toFixed(2)}
            </Row>
          ) : null}
          <Row index={e.confidence !== undefined ? "03" : "02"} label="Found on">
            {u ? (
              <button
                type="button"
                className="text-left underline decoration-line-3 underline-offset-4 hover:decoration-paper"
                onClick={() => onSelect({ kind: "url", id: u.id })}
              >
                {hostText(u)}
              </button>
            ) : (
              "enrichment"
            )}
          </Row>
        </ol>
      );
    }
  } else if (selection?.kind === "bucket") {
    const items = model.urlOrder
      .map((id) => model.urls.get(id)!)
      .filter((u) => u.dropReason === selection.id)
      .slice(-40)
      .reverse();
    title = `${TRAY_LABEL[selection.id]} · ${model.tray[selection.id]}`;
    body = (
      <ul className="flex flex-col border-t border-line" data-testid="tray-items">
        {items.map((u) => (
          <li key={u.id} className="border-b border-line">
            <button
              type="button"
              className="w-full py-2.5 text-left font-mono text-[13px] text-paper hover:text-v-200"
              onClick={() => onSelect({ kind: "url", id: u.id })}
            >
              {hostText(u)}
            </button>
          </li>
        ))}
        {items.length === 0 ? <li className="py-3 text-[15px] text-dim">Nothing here yet.</li> : null}
      </ul>
    );
  }

  const latest = model.entityOrder.slice(-6).reverse();
  return (
    <section aria-labelledby="trail-h" className="flex flex-col gap-4" data-testid="trail-panel">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="trail-h" className="min-w-0 font-mono text-[13px] break-words text-dim">
          {selection ? title : "Trail"}
        </h2>
        {selection ? (
          <button
            type="button"
            className="font-mono text-[12px] text-mute hover:text-paper"
            onClick={() => onSelect(null)}
          >
            Clear
          </button>
        ) : null}
      </div>
      {body ?? (
        <div className="flex flex-col gap-4">
          <p className="text-[15px] text-dim">
            Select a mark, a reason in the tray or an entity to follow its trail: which engine found it,
            whether it was kept, what fetching it returned and what it held.
          </p>
          {latest.length > 0 ? (
            <ul className="flex flex-col border-t border-line" aria-label="Latest entities">
              {latest.map((id) => {
                const e = model.entities.get(id)!;
                return (
                  <li key={id} className="border-b border-line">
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2.5 py-2.5 text-left font-mono text-[13px] text-paper",
                        "hover:text-v-200",
                      )}
                      onClick={() => onSelect({ kind: "entity", id })}
                    >
                      <TypeGlyph type={e.type} />
                      <span className="min-w-0 truncate">{e.display}</span>
                      <span className="ml-auto shrink-0 text-[12px] text-mute">
                        {entityTypeLabel(e.type)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}
