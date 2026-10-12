"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle, cn } from "@voidaccess/ui";
import { STAGES, type Stage } from "@voidaccess/config";
import { COUNT_LABELS, STAGE_LABELS, failureCopy } from "@/content/stages";
import { DEPTH_COPY } from "@/content/examples";
import { StatusBadge } from "@/components/status-badge";
import { FormError } from "@/components/field";

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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={state.status} />
          <span className="text-sm text-fg-secondary">{depthLabel}</span>
          <span className="text-sm text-fg-secondary">·</span>
          <span
            className="font-mono text-sm text-fg-secondary tabular-nums"
            data-testid="elapsed"
            aria-label="Elapsed time"
          >
            {formatElapsed(end - start)}
          </span>
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight break-words sm:text-3xl">
          {initial.title}
        </h1>
      </header>

      {state.status === "launching" || state.status === "reserved" ? (
        <p className="text-sm text-fg-secondary" role="status" data-testid="run-launching">
          Starting a secure environment… This can take a minute or two.
        </p>
      ) : null}

      {state.status === "completed" ? (
        <Card className="border-success/30" data-testid="run-completed">
          <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-fg">Your investigation is ready.</p>
            <Link href={`/investigations/${initial.id}/results`}>
              <Button>View results</Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {state.status === "failed" ? (
        <Card className="border-danger/30" data-testid="run-failed">
          <CardContent className="flex flex-col gap-2 pt-5">
            <p className="text-fg">{failureCopy(state.failureReason)}</p>
            <p className="text-sm text-fg-secondary">
              You were refunded <span className="font-mono text-fg">{state.refunded}</span> credits
              {charged > 0 && state.refunded >= charged ? " (all of it)" : ""}.
            </p>
            <Link href="/investigations/new" className="text-sm text-accent underline underline-offset-2">
              Start another
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {state.status === "cancelled" ? (
        <Card className="border-border-strong" data-testid="run-cancelled">
          <CardContent className="flex flex-col gap-2 pt-5">
            <p className="text-fg">You cancelled this investigation.</p>
            <p className="text-sm text-fg-secondary">
              Refunded{" "}
              <span className="font-mono text-fg" data-testid="refunded">
                {state.refunded}
              </span>{" "}
              of <span className="font-mono text-fg">{charged}</span> credits, the share for the stages that
              hadn&apos;t run yet.
            </p>
            <Link href="/investigations/new" className="text-sm text-accent underline underline-offset-2">
              Start another
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col" aria-label="Stages">
            {STAGES.map((stage, i) => {
              const s = state.stages[stage];
              const finished = s === "end" || s === "skipped" || (state.status === "completed" && !s);
              const current = !done && s === "start";
              const failed = s === "failed";
              return (
                <li
                  key={stage}
                  aria-current={current ? "step" : undefined}
                  data-state={failed ? "failed" : finished ? "done" : current ? "current" : "pending"}
                  className="flex gap-3"
                >
                  <div className="flex flex-col items-center">
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                        finished && "border-success/40 bg-success/15 text-success",
                        current && "border-accent bg-accent-dim text-accent",
                        failed && "border-danger/40 bg-danger/15 text-danger",
                        !finished && !current && !failed && "border-border-strong text-fg-muted",
                      )}
                    >
                      {finished ? (
                        "✓"
                      ) : failed ? (
                        "!"
                      ) : current ? (
                        <span className="size-2 animate-pulse rounded-full bg-accent" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    {i < STAGES.length - 1 ? (
                      <span aria-hidden className="my-1 w-px grow bg-border-subtle" />
                    ) : null}
                  </div>
                  <div className={cn("pb-4", !finished && !current && !failed && "opacity-60")}>
                    <p className={cn("text-sm font-medium", current ? "text-accent" : "text-fg")}>
                      {STAGE_LABELS[stage].label}
                      {current ? <span className="sr-only"> (in progress)</span> : null}
                      {s === "skipped" ? (
                        <span className="ml-2 text-xs font-normal text-fg-muted">skipped</span>
                      ) : null}
                    </p>
                    <p className="text-sm text-fg-secondary">{STAGE_LABELS[stage].detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      <section aria-label="Counts" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {COUNT_LABELS.map(([key, label]) => (
          <div key={key} className="rounded-lg border border-border-subtle bg-surface p-4">
            <p className="font-mono text-2xl font-medium tabular-nums text-fg" data-testid={`count-${key}`}>
              {(state.counts[key] ?? 0).toLocaleString("en-US")}
            </p>
            <p className="text-xs text-fg-secondary">{label}</p>
          </div>
        ))}
      </section>

      {state.refined.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>We&apos;re searching for</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5 text-sm text-fg-secondary">
              {state.refined.map((q) => (
                <li
                  key={q}
                  className="rounded-md bg-raised px-3 py-1.5 font-mono text-xs break-words text-fg"
                >
                  {q}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {!done ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-fg-secondary">
            You can leave this page. The investigation keeps running and we&apos;ll email you when it&apos;s
            ready.
          </p>
          <Button
            variant="secondary"
            onClick={cancel}
            loading={cancelBusy}
            disabled={state.cancelRequested || state.status === "ingesting"}
          >
            {state.cancelRequested ? "Cancelling…" : "Cancel"}
          </Button>
        </div>
      ) : null}
      <FormError message={error} />
    </div>
  );
}
