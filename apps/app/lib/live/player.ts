/**
 * Plays the run's events into the LiveModel at the pace they happened (P8).
 *
 * Event time, not arrival time: the SSE stream delivers events in bursts (one poll every ~1.5 s, traces batched by
 * the runner every 300 ms). The playhead advances with the frame clock (x speed) but never runs past the newest
 * event seen, so each burst is spread back over the time it took instead of landing at once. Long idle gaps (Tor
 * bootstrap, an LLM call) are compressed, and a playhead that falls far behind jumps forward, applying the skipped
 * events without motion. Work is batched per animation frame (at most MAX_PER_FRAME animated events).
 *
 * `instant` events (the backlog before the stream's `live` marker, or anything that arrives while the tab is
 * hidden) are applied without effects: late joiners and reloads fast-forward to now, then go live.
 */
import { LiveModel, type Effect, type LiveEvent } from "./model";

export const MAX_PER_FRAME = 60;
/** Gaps longer than this (event time) are shortened to GAP_KEEP_MS. */
export const GAP_MS = 1500;
export const GAP_KEEP_MS = 350;
/** If the playhead is this far behind the newest event, jump to BEHIND_KEEP_MS behind it. */
export const BEHIND_MS = 6000;
export const BEHIND_KEEP_MS = 2500;

const t = (e: LiveEvent) => {
  const v = Date.parse(e.at);
  return Number.isFinite(v) ? v : 0;
};

export class Player {
  private queue: LiveEvent[] = [];
  private head = 0;
  private playhead: number | null = null;
  private newest = -Infinity;
  speed = 1;
  paused = false;
  /** Bumped whenever events were applied without motion; the scene then rebuilds its marks at rest. */
  jumps = 0;
  /** Live only: jump forward when far behind the newest event. Replay plays everything at the chosen speed. */
  catchUp = true;

  constructor(readonly model: LiveModel) {}

  get pending(): number {
    return this.queue.length - this.head;
  }

  /** Queue events (seq order). With `instant`, apply them now with no motion. */
  push(events: LiveEvent[], instant = false): void {
    if (instant) {
      this.flush();
      for (const e of events) this.model.apply(e);
      this.jumps++;
      for (const e of events) this.newest = Math.max(this.newest, t(e));
      this.playhead = Math.max(this.playhead ?? -Infinity, this.newest);
      return;
    }
    for (const e of events) {
      this.queue.push(e);
      this.newest = Math.max(this.newest, t(e));
    }
  }

  /** Apply everything queued without motion (tab hidden, reduced motion, skip to end). */
  flush(): void {
    if (this.head < this.queue.length) this.jumps++;
    while (this.head < this.queue.length) this.model.apply(this.queue[this.head++]!);
    this.compact();
    if (Number.isFinite(this.newest)) this.playhead = this.newest;
  }

  /** Advance by `dtMs` of wall time; returns the effects of the events released this frame. */
  tick(dtMs: number): Effect[] {
    if (this.paused || this.head >= this.queue.length) return [];
    const next = t(this.queue[this.head]!);
    if (this.playhead === null) this.playhead = next;
    let ph = this.playhead + dtMs * this.speed;
    if (next - ph > GAP_MS) ph = next - GAP_KEEP_MS;
    ph = Math.min(ph, this.newest);
    const out: Effect[] = [];
    // far behind: jump, applying what we skip without motion
    if (this.catchUp && this.newest - ph > BEHIND_MS) {
      const target = this.newest - BEHIND_KEEP_MS;
      this.jumps++;
      while (this.head < this.queue.length && t(this.queue[this.head]!) <= target)
        this.model.apply(this.queue[this.head++]!);
      ph = target;
    }
    let n = 0;
    while (this.head < this.queue.length && t(this.queue[this.head]!) <= ph) {
      const e = this.queue[this.head++]!;
      if (n < MAX_PER_FRAME) {
        for (const fx of this.model.apply(e)) out.push(fx);
        n++;
      } else this.model.apply(e);
    }
    this.playhead = ph;
    this.compact();
    return out;
  }

  private compact() {
    if (this.head > 512 && this.head * 2 > this.queue.length) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }
  }
}
