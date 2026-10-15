"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { Button, ButtonArrow, buttonVariants, cn } from "@voidaccess/ui";
import { STAGES, type Stage } from "@voidaccess/config";
import { COUNT_LABELS, STAGE_LABELS, failureCopy } from "@/content/stages";
import { DEPTH_COPY } from "@/content/examples";
import { StatusBadge } from "@/components/status-badge";
import { FormError } from "@/components/field";
import { Index } from "@/components/page-header";

export interface RunSnapshot {
  id: string;
  title: string;
  depth: string;
  status: string;
  failureReason: string | null;
  refinedQueries: string[];
  startedAt: string;
  completedAt: string | null;
  cancelRequested: boolean;
  creditsReserved: number;
  creditsRefunded: number;
  stagesCompleted: string[];
  currentStage: string | null;
  counts: Record<string, number> | null;
}

type StageState = "start" | "end" | "skipped" | "failed";
interface State {
  status: string;
  failureReason: string | null;
  refined: string[];
  stages: Partial<Record<Stage, StageState>>;
  counts: Record<string, number>;
  cancelRequested: boolean;
  refunded: number;
  endedAt: string | null;
}

type Action =
  | {
      t: "progress";
      d: {
        type: string;
        stage?: Stage | null;
        status?: string;
        counts?: Record<string, number> | null;
        at: string;
      };
    }
  | {
      t: "status";
      d: {
        status: string;
        refinedQueries?: string[];
        failureReason?: string | null;
        cancelRequested?: boolean;
        creditsRefunded?: number;
      };
    }
  | { t: "cancelling" };

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function init(s: RunSnapshot): State {
  const stages: State["stages"] = {};
  for (const st of s.stagesCompleted) stages[st as Stage] = "end";
  if (s.currentStage && !stages[s.currentStage as Stage]) stages[s.currentStage as Stage] = "start";
  return {
    status: s.status,
    failureReason: s.failureReason,
    refined: s.refinedQueries,
    stages,
    counts: s.counts ?? {},
    cancelRequested: s.cancelRequested,
    refunded: s.creditsRefunded,
    endedAt: s.completedAt,
  };
}

function reduce(state: State, a: Action): State {
  switch (a.t) {
    case "cancelling":
      return { ...state, cancelRequested: true };
    case "progress": {
      const { type, stage, status, counts, at } = a.d;
      const next = { ...state };
      if (counts) next.counts = { ...state.counts, ...counts };
      if (type === "stage" && stage) {
        const prev = state.stages[stage];
        // never move a finished stage back to "start" when events are replayed
        if (!(prev && prev !== "start" && (status ?? "start") === "start"))
          next.stages = { ...state.stages, [stage]: (status ?? "start") as StageState };
      }
      if (TERMINAL.has(type)) next.endedAt = at;
      return next;
    }
    case "status": {
      const d = a.d;
      return {
        ...state,
        status: d.status,
        refined: d.refinedQueries?.length ? d.refinedQueries : state.refined,
        failureReason: d.failureReason ?? state.failureReason,
        cancelRequested: d.cancelRequested ?? state.cancelRequested,
        refunded: d.creditsRefunded ?? state.refunded,
        endedAt: TERMINAL.has(d.status) ? (state.endedAt ?? new Date().toISOString()) : state.endedAt,
      };
    }
  }
}

function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function LiveProgress({ initial }: { initial: RunSnapshot }) {
  const [state, dispatch] = useReducer(reduce, initial, init);
  const [now, setNow] = useState(() => Date.now());
  const [cancelBusy, setCancelBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = TERMINAL.has(state.status);
  const sourceRef = useRef<EventSource | null>(null);

  // Live stream. Closed as soon as the run is terminal so the browser doesn't reconnect forever.
  useEffect(() => {
    if (TERMINAL.has(initial.status)) return;
    const es = new EventSource(`/api/investigations/${initial.id}/events`);
    sourceRef.current = es;
    es.addEventListener("progress", (e) =>
      dispatch({ t: "progress", d: JSON.parse((e as MessageEvent).data) }),
    );
    es.addEventListener("status", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      dispatch({ t: "status", d });
      if (TERMINAL.has(d.status)) {
        es.close();
        window.dispatchEvent(new Event("va:balance-changed"));
      }
    });
    return () => es.close();
  }, [initial.id, initial.status]);

  useEffect(() => {
    if (done) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [done]);

  const cancel = useCallback(async () => {
    setCancelBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/investigations/${initial.id}/cancel`, { method: "POST" });
      const b = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) setError(b.message ?? "Could not cancel");
      else dispatch({ t: "cancelling" });
    } finally {
      setCancelBusy(false);
    }
  }, [initial.id]);

  const start = new Date(initial.startedAt).getTime();
  const end = state.endedAt ? new Date(state.endedAt).getTime() : now;
  const depthLabel = DEPTH_COPY[initial.depth as keyof typeof DEPTH_COPY]?.label ?? initial.depth;
  const charged = initial.creditsReserved;

  const doneCount = STAGES.filter((st) => {
    const v = state.stages[st];
    return v === "end" || v === "skipped" || (state.status === "completed" && !v);
  }).length;

  return (
    <div className="va-rise flex flex-col gap-14">
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusBadge status={state.status} />
          <span aria-hidden className="h-3 w-px bg-line-2" />
          <span className="font-mono text-[12.5px] text-dim">{depthLabel}</span>
          <span aria-hidden className="h-3 w-px bg-line-2" />
          <span
            className="font-mono text-[12.5px] text-dim tabular-nums"
            data-testid="elapsed"
            aria-label="Elapsed time"
          >
            {formatElapsed(end - start)}
          </span>
        </div>
        <h1 className="max-w-[24ch] text-[clamp(32px,3.2vw,44px)] leading-[1.04] font-medium tracking-[-0.04em] break-words">
          {initial.title}
        </h1>
      </header>

      {state.status === "launching" || state.status === "reserved" ? (
        <p className="-mt-8 text-[15px] text-dim" role="status" data-testid="run-launching">
          Starting a secure environment… This can take a minute or two.
        </p>
      ) : null}

      {state.status === "completed" ? (
        <section
          className="flex flex-col gap-5 border-y border-line py-7 sm:flex-row sm:items-center sm:justify-between"
          data-testid="run-completed"
        >
          <p className="text-[21px] leading-[1.2] font-medium tracking-[-0.02em]">
            Your investigation is ready.
          </p>
          <Link href={`/investigations/${initial.id}/results`} className={buttonVariants({ size: "lg" })}>
            <span className="inline-flex items-center gap-2.5">
              View results
              <ButtonArrow />
            </span>
          </Link>
        </section>
      ) : null}

      {state.status === "failed" ? (
        <section className="flex flex-col gap-3 border-y border-line py-7" data-testid="run-failed">
          <p className="text-[21px] leading-[1.25] font-medium tracking-[-0.02em]">
            {failureCopy(state.failureReason)}
          </p>
          <p className="text-[15px] text-dim">
            You were refunded <span className="font-mono text-[14px] text-paper">{state.refunded}</span>{" "}
            credits
            {charged > 0 && state.refunded >= charged ? " (all of it)" : ""}.
          </p>
          <Link href="/investigations/new" className="va-link self-start text-[15px]">
            Start another
          </Link>
        </section>
      ) : null}

      {state.status === "cancelled" ? (
        <section className="flex flex-col gap-3 border-y border-line py-7" data-testid="run-cancelled">
          <p className="text-[21px] leading-[1.25] font-medium tracking-[-0.02em]">
            You cancelled this investigation.
          </p>
          <p className="text-[15px] text-dim">
            Refunded{" "}
            <span className="font-mono text-[14px] text-paper" data-testid="refunded">
              {state.refunded}
            </span>{" "}
            of <span className="font-mono text-[14px] text-paper">{charged}</span> credits, the share for the
            stages that hadn&apos;t run yet.
          </p>
          <Link href="/investigations/new" className="va-link self-start text-[15px]">
            Start another
          </Link>
        </section>
      ) : null}

      <div className="grid grid-cols-12 gap-x-6 gap-y-12 max-[960px]:grid-cols-1">
        <section
          aria-labelledby="progress-h"
          className="col-span-7 flex flex-col gap-6 max-[960px]:col-span-1"
        >
          <div className="flex items-center justify-between gap-4">
            <Index>
              <span id="progress-h">Progress</span>
            </Index>
            <p className="font-mono text-[12.5px] text-dim tabular-nums">
              Stage{" "}
              <span className="text-paper">
                {String(Math.min(doneCount + (done ? 0 : 1), STAGES.length)).padStart(2, "0")}
              </span>{" "}
              of {String(STAGES.length).padStart(2, "0")}
            </p>
          </div>
          {/* The ruler: a hairline track with a paper fill for the stages that have run. */}
          <div aria-hidden className="relative h-px bg-line-2">
            <div
              className="absolute inset-y-0 left-0 bg-paper transition-[width] duration-700 ease-out"
              style={{ width: `${(doneCount / STAGES.length) * 100}%` }}
            />
          </div>
          <ol className="flex flex-col" aria-label="Stages">
            {STAGES.map((stage, i) => {
              const s = state.stages[stage];
              const finished = s === "end" || s === "skipped" || (state.status === "completed" && !s);
              const current = !done && s === "start";
              const failed = s === "failed";
              const pending = !finished && !current && !failed;
              return (
                <li
                  key={stage}
                  aria-current={current ? "step" : undefined}
                  data-state={failed ? "failed" : finished ? "done" : current ? "current" : "pending"}
                  className="grid grid-cols-[44px_1fr_auto] items-baseline gap-x-3 border-b border-line py-4"
                >
                  <span
                    className={cn(
                      "font-mono text-[13px] tabular-nums transition-colors duration-[400ms]",
                      pending ? "text-faint" : "text-dim",
                      current && "text-paper",
                    )}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <p
                      className={cn(
                        "text-[17px] leading-[1.3] font-medium tracking-[-0.01em] transition-colors duration-[400ms]",
                        pending ? "text-mute" : "text-paper",
                      )}
                    >
                      {STAGE_LABELS[stage].label}
                      {current ? <span className="sr-only"> (in progress)</span> : null}
                      {s === "skipped" ? (
                        <span className="ml-2.5 font-mono text-[12px] font-normal text-mute">skipped</span>
                      ) : null}
                    </p>
                    <p className={cn("text-[15px] leading-[1.5]", pending ? "text-mute" : "text-dim")}>
                      {STAGE_LABELS[stage].detail}
                    </p>
                  </div>
                  <span aria-hidden className="flex h-5 items-center font-mono text-[12px]">
                    {finished ? (
                      <span className="text-paper">✓</span>
                    ) : failed ? (
                      <span className="rounded-xs border border-line-3 px-1.5 py-0.5 text-paper">
                        ✕ Failed
                      </span>
                    ) : current ? (
                      <span className="flex items-center gap-2 text-paper">
                        <span className="size-1.5 rounded-full bg-v-500" />
                        Now
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="col-span-4 col-start-9 flex flex-col gap-12 max-[960px]:col-span-1 max-[960px]:col-start-1">
          <section aria-label="Counts" className="flex flex-col gap-6">
            <Index>Found</Index>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
              {COUNT_LABELS.map(([key, label]) => (
                <div key={key} className="flex flex-col gap-3 bg-bg p-5">
                  <p className="font-mono text-[12px] leading-none text-mute">{label}</p>
                  <p
                    className="font-mono text-[28px] leading-none tracking-[-0.04em] text-paper tabular-nums max-[960px]:text-[22px]"
                    data-testid={`count-${key}`}
                  >
                    {(state.counts[key] ?? 0).toLocaleString("en-US")}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {state.refined.length > 0 ? (
            <section className="flex flex-col gap-5" aria-labelledby="refined-h">
              <Index>
                <span id="refined-h">We&apos;re searching for</span>
              </Index>
              <ul className="flex flex-col border-t border-line">
                {state.refined.map((q) => (
                  <li
                    key={q}
                    className="border-b border-line py-3 font-mono text-[13px] leading-[1.5] break-words text-paper"
                  >
                    {q}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>

      {!done ? (
        <div className="flex flex-col gap-4 border-t border-line pt-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[60ch] text-[15px] text-dim">
            You can leave this page. The investigation keeps running and we&apos;ll email you when it&apos;s
            ready.
          </p>
          <Button
            variant="secondary"
            onClick={cancel}
            loading={cancelBusy}
            disabled={state.cancelRequested || state.status === "ingesting"}
          >
            {state.cancelRequested ? "Cancelling…" : "Cancel investigation"}
          </Button>
        </div>
      ) : null}
      <FormError message={error} />
    </div>
  );
}
