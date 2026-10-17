"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { STAGES } from "@voidaccess/config";
import { cn } from "@voidaccess/ui";
import { Index } from "@/components/page-header";
import { instrumentHeight, layout } from "@/lib/live/geometry";
import { TRAY_BUCKETS, outcomeLabel, type LiveModel } from "@/lib/live/model";
import type { Player } from "@/lib/live/player";
import type { LiveScene } from "@/lib/live/scene";
import { LiveLog } from "./live-log";
import { STAGE_SHORT, stageStat } from "./stage-stats";
import { TrailPanel, type Selection } from "./trail-panel";

/** React re-renders the DOM parts (numbers, rows, tray) at most this often; the canvas draws every frame. */
const SNAPSHOT_MS = 250;
/** The screen-reader summary changes at most this often, never a flood. */
const ARIA_MS = 8000;

const reducedQuery = "(prefers-reduced-motion: reduce)";
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(reducedQuery);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(reducedQuery).matches,
    () => false,
  );
}

function webgl2(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** Frame timing for the performance check (read by e2e; no effect on the view). */
export interface LiveStats {
  frames: number;
  /** mean and p95 time between frames, ms */
  frameMs: number;
  p95Ms: number;
  /** mean time spent in our own per-frame work, ms */
  workMs: number;
  particles: number;
  labels: number;
  heapMb: number | null;
}
declare global {
  interface Window {
    __vaLive?: LiveStats;
  }
}

/**
 * The live instrument (P8-4): "the noise flattening". Eight hairline stage columns over the brand terrain; URLs
 * stream in from the search engines as host-labelled dots, noise falls into the discarded tray with its reason,
 * kept pages pass the filter gate, entities rise out of their page and assemble into a small live graph, and the
 * ground calms as noise is discarded while the one violet line, the signal, strengthens as entities are found.
 * prefers-reduced-motion swaps all motion for the calm live log; screen readers get a throttled summary.
 */
export function LiveInstrument({
  model,
  player,
  done,
  label = "Live",
  controls,
}: {
  model: LiveModel;
  player: Player;
  /** the run reached a terminal state (or a replay finished) */
  done: boolean;
  label?: string;
  controls?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const terrainRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<LiveScene | null>(null);
  const [width, setWidth] = useState(0);
  const [, setTick] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [aria, setAria] = useState("");
  const selRef = useRef<Selection>(null);
  selRef.current = selection;

  // width (layout is computed from it, for the canvas and the DOM overlay alike)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [reduced]);

  // throttled screen-reader summary
  useEffect(() => {
    let last = "";
    const upd = () => {
      const s = model.summaryLine();
      if (s !== last) {
        last = s;
        setAria(s);
      }
    };
    upd();
    const id = setInterval(upd, ARIA_MS);
    return () => clearInterval(id);
  }, [model]);

  // reduced motion: no animation loop; apply everything as it arrives and refresh the log
  useEffect(() => {
    if (!reduced) return;
    let ver = -1;
    const id = setInterval(() => {
      player.flush();
      if (model.version !== ver) {
        ver = model.version;
        setTick((t) => t + 1);
      }
    }, 500);
    return () => clearInterval(id);
  }, [reduced, model, player]);

  // the animation loop
  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    const labels = labelRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !labels || !wrap) return;
    let dead = false;
    let raf = 0;
    let scene: LiveScene | null = null;
    let terrain: import("@/lib/live/terrain").LiveTerrain | null = null;
    let visible = true;
    let jumps = -1;
    let lastSnap = 0;
    let lastVer = -1;
    let last = performance.now();
    const gaps: number[] = [];
    let work = 0;
    let frames = 0;

    const io = new IntersectionObserver((es) => es.forEach((e) => (visible = e.isIntersecting)), {
      rootMargin: "120px",
    });
    io.observe(wrap);
    const onVis = () => {
      if (!document.hidden) {
        player.flush(); // back from a hidden tab: catch up at rest, then go live
        last = performance.now();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    const loop = (now: number) => {
      if (dead) return;
      raf = requestAnimationFrame(loop);
      const gap = now - last;
      last = now;
      const dt = Math.min(0.05, gap / 1000);
      const t0 = performance.now();
      if (document.hidden) return;
      const fx = player.tick(gap);
      if (scene) {
        if (player.jumps !== jumps) {
          jumps = player.jumps;
          scene.sync();
        }
        scene.apply(fx);
        scene.update(dt, now / 1000);
        if (visible) scene.draw();
      }
      if (terrain && visible) {
        terrain.target.clear = model.noiseCleared();
        terrain.target.signal = model.signal();
        terrain.frame(dt);
      }
      if (model.version !== lastVer && now - lastSnap > SNAPSHOT_MS) {
        lastVer = model.version;
        lastSnap = now;
        setTick((x) => x + 1);
      }
      // stats (ring of the last 240 frame gaps)
      frames++;
      work += performance.now() - t0;
      gaps.push(gap);
      if (gaps.length > 240) gaps.shift();
      if (frames % 30 === 0) {
        const sorted = [...gaps].sort((a, b) => a - b);
        const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        window.__vaLive = {
          frames,
          frameMs: gaps.reduce((a, b) => a + b, 0) / gaps.length,
          p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
          workMs: work / frames,
          particles: scene?.particleCount ?? 0,
          labels: scene?.labelCount ?? 0,
          heapMb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
        };
      }
    };

    void import("@/lib/live/scene").then(({ LiveScene }) => {
      if (dead) return;
      scene = new LiveScene(canvas, labels, model, wrap.clientWidth || 1200);
      sceneRef.current = scene;
      scene.sync();
      jumps = player.jumps;
      raf = requestAnimationFrame(loop);
    });
    if (terrainRef.current && webgl2())
      void import("@/lib/live/terrain")
        .then(({ LiveTerrain }) => {
          if (dead || !terrainRef.current) return;
          terrain = new LiveTerrain(terrainRef.current);
          terrain.target.clear = model.noiseCleared();
          terrain.target.signal = model.signal();
          terrain.settle();
        })
        .catch((e) => console.warn("Terrain unavailable", e));

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      scene?.dispose();
      sceneRef.current = null;
      terrain?.dispose();
    };
  }, [reduced, model, player]);

  // resize the canvas + terrain with the layout
  useEffect(() => {
    if (!width || reduced) return;
    sceneRef.current?.resize(width);
  }, [width, reduced]);

  useEffect(() => {
    if (sceneRef.current)
      sceneRef.current.selected = selection && selection.kind !== "bucket" ? selection.id : null;
  }, [selection]);

  const onPointer = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = sceneRef.current;
    if (!s) return;
    const r = e.currentTarget.getBoundingClientRect();
    const id = s.hit(e.clientX - r.left, e.clientY - r.top);
    if (!id) return;
    setSelection(model.urls.has(id) ? { kind: "url", id } : { kind: "entity", id });
  };

  const g = layout(width || 1200);
  const h = instrumentHeight(width || 1200);
  const current = model.currentStage();

  return (
    <section aria-labelledby="live-h" className="flex flex-col gap-6" data-testid="live-instrument">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Index>
          <span id="live-h">{label}</span>
        </Index>
        <div className="flex items-center gap-5">
          {controls}
          <p className="font-mono text-[12.5px] text-dim tabular-nums" data-testid="live-discarded">
            Discarded <span className="text-paper">{model.discarded.toLocaleString("en-US")}</span>
            <span aria-hidden className="mx-2.5 inline-block h-3 w-px translate-y-0.5 bg-line-2" />
            Kept <span className="text-paper">{model.kept.toLocaleString("en-US")}</span>
          </p>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite" data-testid="live-aria">
        {aria}
      </p>

      {reduced ? (
        <LiveLog model={model} done={done} onSelect={setSelection} />
      ) : (
        <div
          ref={wrapRef}
          className="relative w-full overflow-hidden border-y border-line select-none"
          style={{ height: h }}
        >
          {/* the ground ends above the tray, fading into the page (design.md §7: a functional fade only) */}
          <div
            ref={terrainRef}
            aria-hidden
            className="absolute top-0 right-0 [&>canvas]:h-full! [&>canvas]:w-full!"
            style={{ height: g.tray.y, left: g.terrainX }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 w-16 bg-linear-to-r from-bg to-transparent"
            style={{ left: g.terrainX, height: g.tray.y }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bg-linear-to-b from-transparent to-bg"
            style={{ top: g.tray.y - 90, height: 90 }}
          />
          <StageColumns model={model} g={g} current={current} done={done} />
          <canvas
            ref={canvasRef}
            aria-hidden
            className="absolute inset-0 cursor-crosshair"
            onClick={onPointer}
            data-testid="live-canvas"
          />
          <div ref={labelRef} aria-hidden className="pointer-events-none absolute inset-0" />
          <Tray model={model} g={g} onSelect={setSelection} />
        </div>
      )}

      <TrailPanel model={model} selection={selection} onSelect={setSelection} />
    </section>
  );
}

function StageColumns({
  model,
  g,
  current,
  done,
}: {
  model: LiveModel;
  g: ReturnType<typeof layout>;
  current: string | null;
  done: boolean;
}) {
  const engines = [...model.engines.values()].slice(0, 8);
  const queries = model.queries.filter(Boolean).slice(0, 3);
  const enrich = [...model.enrich.values()].slice(0, 10);
  return (
    <ol aria-label="Stages" className="pointer-events-none absolute inset-0">
      {STAGES.map((s, i) => {
        const lane = g.lane[i]!;
        const st = model.stages[s];
        const finished = st === "end" || st === "skipped" || model.terminal === "completed";
        const now = !done && current === s && st === "start";
        const stat = stageStat(model, s, done);
        return (
          <li
            key={s}
            data-stage={s}
            data-state={
              st === "failed" ? "failed" : finished ? "done" : now ? "current" : st ? "started" : "pending"
            }
            aria-current={now ? "step" : undefined}
            className={cn(
              "absolute",
              i > 0 && !g.small && "border-l border-line",
              g.small && "border-b border-line",
            )}
            style={{ left: lane.x, top: lane.y, width: lane.w, height: lane.h }}
          >
            {/* the stage's top rule: drawn while it runs, held once done */}
            {now || finished ? (
              <span
                aria-hidden
                className={cn(
                  "absolute top-0 left-0 h-px w-full",
                  now ? "va-rule-draw bg-paper" : "bg-line-3",
                )}
              />
            ) : null}
            <div className={cn("flex flex-col gap-1.5", g.small ? "px-0 pt-3.5" : "px-3.5 pt-4")}>
              <p className="flex items-baseline gap-2.5 font-mono text-[12px] leading-none">
                <span className={cn("tabular-nums", now ? "text-paper" : st ? "text-dim" : "text-faint")}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className={cn(
                    "font-sans text-[15px] font-medium tracking-[-0.01em]",
                    st || finished ? "text-paper" : "text-mute",
                  )}
                >
                  {STAGE_SHORT[s]}
                </span>
                {st === "failed" ? <span className="text-dim">stopped</span> : null}
                {st === "skipped" ? <span className="text-mute">skipped</span> : null}
              </p>
              <p className="h-4 font-mono text-[12px] text-dim tabular-nums" data-testid={`stat-${s}`}>
                {stat}
              </p>
            </div>
            {/* column contents that are text, not marks */}
            {!g.small && s === "refine" ? (
              <div className="absolute inset-x-3.5 flex flex-col gap-3" style={{ top: g.stage[0]!.y - 6 }}>
                <ul className="flex flex-col gap-1">
                  {queries.map((q, k) => (
                    <li key={k} className="truncate font-mono text-[11.5px] leading-[1.4] text-dim" title={q}>
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!g.small && s === "refine" && engines.length ? (
              <ul className="absolute inset-x-3.5 flex flex-col" style={{ top: g.stage[0]!.y + 92 - 6 }}>
                {engines.map((e) => (
                  <li
                    key={e.engine}
                    className="flex h-4 items-baseline justify-between gap-2 font-mono text-[11.5px]"
                  >
                    <span className="truncate text-dim">{e.engine}</span>
                    <span className="text-mute tabular-nums">
                      {e.status && e.status !== "ok" ? outcomeLabel(e.status) : e.results}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {!g.small && s === "filter" ? (
              <div
                aria-hidden
                className="absolute w-5 border-x border-line-2"
                style={{ left: g.gateX - lane.x - 10, top: g.stage[2]!.y, height: g.stage[2]!.h }}
              />
            ) : null}
            {!g.small && s === "enrich" ? (
              <ul
                className="absolute inset-x-3.5 flex flex-col"
                style={{ top: g.stage[5]!.y - 6 }}
                data-testid="enrich-rows"
              >
                {enrich.map((r) => (
                  <li
                    key={r.source}
                    className="flex h-5 items-baseline justify-between gap-2 font-mono text-[11.5px]"
                  >
                    <span className="truncate text-dim">{r.source}</span>
                    <span className={cn("tabular-nums", r.status === "ok" ? "text-paper" : "text-mute")}>
                      {r.status === "ok" ? (r.hits ?? "ok") : outcomeLabel(r.status)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {s === "summarize" && model.summary && !finished ? (
              <p
                className={cn(
                  "absolute font-mono text-[11.5px] text-dim",
                  g.small ? "right-0 top-3.5" : "inset-x-3.5",
                )}
                style={g.small ? undefined : { top: g.stage[7]!.y + g.stage[7]!.h - 18 }}
              >
                {model.summary.kind === "llm" ? "Writing" : "Assembling"}
                {model.summary.attempt && model.summary.attempt > 1
                  ? ` · attempt ${model.summary.attempt}`
                  : ""}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Tray({
  model,
  g,
  onSelect,
}: {
  model: LiveModel;
  g: ReturnType<typeof layout>;
  onSelect: (s: Selection) => void;
}) {
  return (
    <div
      className="absolute inset-x-0 border-t border-line-2"
      style={{ top: g.tray.y, height: g.tray.h }}
      data-testid="tray"
    >
      <p className="absolute top-3 left-3.5 font-mono text-[12px] text-dim max-[960px]:left-1">
        Discarded{" "}
        <span className="text-paper tabular-nums" data-testid="tray-total">
          {model.discarded.toLocaleString("en-US")}
        </span>
        {Object.keys(model.truncated).length ? <span className="text-mute"> · more not shown</span> : null}
      </p>
      <ul aria-label="Discarded, by reason">
        {TRAY_BUCKETS.map(([k, label]) => {
          const sl = g.slot[k];
          const nn = model.tray[k];
          return (
            <li
              key={k}
              className="absolute"
              style={{ left: sl.x - 2, top: sl.y - g.tray.y + 2, width: sl.w + 4 }}
            >
              <button
                type="button"
                disabled={nn === 0}
                onClick={() => onSelect({ kind: "bucket", id: k })}
                className="flex w-full flex-col items-start gap-1 rounded-xs px-0.5 text-left font-mono text-[11.5px] leading-none enabled:hover:text-paper disabled:cursor-default"
                data-testid={`tray-${k}`}
              >
                <span className={cn("tabular-nums", nn ? "text-paper" : "text-faint")}>
                  {nn.toLocaleString("en-US")}
                </span>
                <span className={cn("truncate", nn ? "text-dim" : "text-faint")}>{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
