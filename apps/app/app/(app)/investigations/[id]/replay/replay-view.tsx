"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@voidaccess/ui";
import { LiveInstrument } from "@/components/live/live-instrument";
import { LiveModel, type LiveEvent } from "@/lib/live/model";
import { Player } from "@/lib/live/player";

const SPEEDS = [1, 4, 16] as const;
let generation = 0;

function fresh(events: LiveEvent[], speed: number) {
  const model = new LiveModel();
  const player = new Player(model);
  player.catchUp = false; // a replay plays every event at the chosen speed
  player.speed = speed;
  player.push(events);
  return { model, player, gen: ++generation };
}

/** "Replay run" (P8-5): the stored events of a finished investigation, played back at 1x, 4x or 16x. */
export function ReplayView({ id, title }: { id: string; title: string }) {
  const [events, setEvents] = useState<LiveEvent[] | null>(null);
  const [error, setError] = useState(false);
  const [speed, setSpeed] = useState<number>(4);
  const [run, setRun] = useState(() => fresh([], 4));
  const [done, setDone] = useState(false);

  useEffect(() => {
    let dead = false;
    fetch(`/api/investigations/${id}/replay`)
      .then((r) => (r.ok ? (r.json() as Promise<{ events: LiveEvent[] }>) : Promise.reject(new Error())))
      .then((b) => {
        if (dead) return;
        setEvents(b.events);
        setRun(fresh(b.events, 4));
      })
      .catch(() => !dead && setError(true));
    return () => {
      dead = true;
    };
  }, [id]);

  // the replay is done when its queue is empty
  useEffect(() => {
    setDone(false);
    const t = setInterval(() => {
      if (run.player.pending === 0 && run.model.lastSeq >= 0) setDone(true);
    }, 500);
    return () => clearInterval(t);
  }, [run]);

  const pick = (s: number) => {
    setSpeed(s);
    run.player.speed = s;
  };

  const controls = (
    <div className="flex items-center gap-1 font-mono text-[12.5px]" role="group" aria-label="Replay speed">
      {SPEEDS.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={speed === s}
          onClick={() => pick(s)}
          className={cn(
            "rounded-xs border px-2 py-1 tabular-nums transition-colors duration-300",
            speed === s ? "border-line-3 text-paper" : "border-transparent text-mute hover:text-paper",
          )}
          data-testid={`speed-${s}`}
        >
          {s}x
        </button>
      ))}
      <span aria-hidden className="mx-2 h-3 w-px bg-line-2" />
      <button
        type="button"
        className="px-1 py-1 text-mute hover:text-paper"
        onClick={() => events && setRun(fresh(events, speed))}
      >
        Restart
      </button>
      <button
        type="button"
        className="px-1 py-1 text-mute hover:text-paper"
        onClick={() => run.player.flush()}
      >
        Skip to end
      </button>
    </div>
  );

  return (
    <div className="va-rise flex flex-col gap-14">
      <header className="flex flex-col gap-5">
        <Link href={`/investigations/${id}/results`} className="va-link self-start font-mono text-[12.5px]">
          Back to results
        </Link>
        <h1 className="max-w-[24ch] text-[clamp(32px,3.2vw,44px)] leading-[1.04] font-medium tracking-[-0.04em] break-words">
          {title}
        </h1>
        <p className="text-[15px] text-dim">
          A replay of this run from its stored events{done ? ". It has finished." : "."}
        </p>
      </header>
      {error ? (
        <p className="text-[15px] text-dim">This replay isn&apos;t available.</p>
      ) : events === null ? (
        <p className="font-mono text-[13px] text-dim">Loading…</p>
      ) : (
        <LiveInstrument
          key={run.gen}
          model={run.model}
          player={run.player}
          done={done}
          label="Replay"
          controls={controls}
        />
      )}
    </div>
  );
}
