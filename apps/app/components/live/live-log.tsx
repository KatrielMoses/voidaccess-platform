"use client";
import { STAGES } from "@voidaccess/config";
import { TypeGlyph } from "@/components/results/type-glyph";
import { TRAY_BUCKETS, type LiveModel, type LogLine } from "@/lib/live/model";
import { hostText, type Selection } from "./trail-panel";
import { stageStat, STAGE_SHORT } from "./stage-stats";

const VERB: Record<string, string> = {
  found: "found",
  kept: "kept",
  dropped: "dropped",
  read: "read",
  failed: "not read",
  entity: "entity",
  search: "searched",
  enrich: "checked",
  graph: "graph",
  summary: "summary",
  query: "query",
};

function Line({ model, l, onSelect }: { model: LiveModel; l: LogLine; onSelect: (s: Selection) => void }) {
  const idx = String(STAGES.indexOf(l.stage) + 1).padStart(2, "0");
  let subject: React.ReactNode = l.detail ?? "";
  let sel: Selection = null;
  if (l.ref && l.verb === "entity") {
    const e = model.entities.get(l.ref);
    if (e) {
      subject = (
        <span className="inline-flex items-center gap-2">
          <TypeGlyph type={e.type} />
          {e.display}
        </span>
      );
      sel = { kind: "entity", id: e.id };
    }
  } else if (l.ref) {
    const u = model.urls.get(l.ref);
    subject = (
      <>
        {hostText(u)}
        {l.detail && !u?.safety ? <span className="text-dim"> · {l.detail}</span> : null}
      </>
    );
    sel = u ? { kind: "url", id: u.id } : null;
  }
  const body = (
    <>
      <span className="text-mute tabular-nums">{idx}</span>
      <span className="text-dim">{VERB[l.verb] ?? l.verb}</span>
      <span className="min-w-0 break-words text-paper">{subject}</span>
    </>
  );
  const cls =
    "grid w-full grid-cols-[28px_76px_1fr] items-baseline gap-x-3 py-2 text-left font-mono text-[13px]";
  return (
    <li className="border-b border-line">
      {sel ? (
        <button type="button" className={`${cls} hover:bg-accent-dim`} onClick={() => onSelect(sel)}>
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

/**
 * The calm live log (prefers-reduced-motion): the same information as the instrument with no motion. Stage rows
 * with their numbers, the discarded tray as a table of tallies, and the latest events, newest first.
 */
export function LiveLog({
  model,
  done,
  onSelect,
}: {
  model: LiveModel;
  done: boolean;
  onSelect: (s: Selection) => void;
}) {
  const lines = model.log.slice(-40).reverse();
  return (
    <div className="grid grid-cols-12 gap-x-6 gap-y-10 max-[960px]:grid-cols-1" data-testid="live-log">
      <div className="col-span-5 flex flex-col gap-8 max-[960px]:col-span-1">
        <ol className="flex flex-col border-t border-line" aria-label="Stages">
          {STAGES.map((s, i) => {
            const st = model.stages[s];
            const state =
              st === "end" || st === "skipped" || (done && model.terminal === "completed")
                ? "done"
                : st === "start"
                  ? "now"
                  : st === "failed"
                    ? "failed"
                    : "";
            return (
              <li
                key={s}
                className="grid grid-cols-[28px_1fr_auto] items-baseline gap-x-3 border-b border-line py-2.5 font-mono text-[13px]"
              >
                <span className="text-mute tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <span className={st ? "text-paper" : "text-mute"}>
                  {STAGE_SHORT[s]}
                  {state ? <span className="ml-2 text-[12px] text-dim">{state}</span> : null}
                </span>
                <span className="text-dim tabular-nums">{stageStat(model, s, done)}</span>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[13px] text-dim">
            Discarded <span className="text-paper tabular-nums">{model.discarded}</span>
          </p>
          <ul className="grid grid-cols-2 gap-x-6 border-t border-line" aria-label="Discarded, by reason">
            {TRAY_BUCKETS.filter(([k]) => model.tray[k] > 0).map(([k, label]) => (
              <li key={k} className="border-b border-line">
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between py-2 font-mono text-[13px] hover:text-v-200"
                  onClick={() => onSelect({ kind: "bucket", id: k })}
                >
                  <span className="text-dim">{label}</span>
                  <span className="text-paper tabular-nums">{model.tray[k]}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="col-span-7 flex flex-col gap-3 max-[960px]:col-span-1">
        <p className="font-mono text-[13px] text-dim">Latest</p>
        <ol className="flex flex-col border-t border-line" aria-label="Latest events">
          {lines.map((l) => (
            <Line key={l.seq} model={model} l={l} onSelect={onSelect} />
          ))}
          {lines.length === 0 ? (
            <li className="py-3 text-[15px] text-dim">Waiting for the first results.</li>
          ) : null}
        </ol>
      </div>
    </div>
  );
}
