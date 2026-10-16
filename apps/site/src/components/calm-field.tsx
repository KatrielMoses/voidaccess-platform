"use client";

import { useRef, type KeyboardEvent } from "react";
import { useMotion, type Gsap } from "@/lib/motion";

/**
 * The home page's closing "calm field" (design.md §7) behind the sign-in page: paper ridge lines on the page colour,
 * still water until a keystroke drops a ripple; a successful step "locks" it with one larger ripple at the centre,
 * exactly as the home page's hunt field does. The maths, shaders and camera are the home page's own
 * (public/js/terrain-field.js, shared with public/js/terrain-gl.js); this component only mounts it.
 *
 * Decorative (aria-hidden, pointer-events none). DPR capped at 2 and paused off-screen or in a hidden tab (Field).
 * Without WebGL 2, or if the module fails, the box stays the plain page colour.
 */

interface Drop {
  x: number;
  z: number;
  t: number;
  a: number;
}
/** The field's state, read every frame (the home's SIG.final). */
const calm = { on: 0, drops: [] as Drop[] };

interface FieldLike {
  frame(dt: number, now: number): void;
  dispose(): void;
}
interface FieldModule {
  calmField(el: HTMLElement, state: typeof calm, opts: { still: boolean }): FieldLike;
}

function push(d: Omit<Drop, "t">) {
  calm.drops.push({ ...d, t: performance.now() / 1000 });
  if (calm.drops.length > 8) calm.drops.shift();
}

/** onKeyDown for the page's inputs: a printable key or Backspace drops a small ripple somewhere on the field. */
export function rippleOnKey(e: KeyboardEvent) {
  if (e.key.length === 1 || e.key === "Backspace") push({ x: (Math.random() - 0.5) * 7, z: -1 - Math.random() * 4, a: 0.22 });
}

/** A successful step: one larger ripple from the centre. */
export function lockField() {
  push({ x: 0, z: -2.5, a: 0.55 });
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

// A runtime URL in public/, not a bundled module: the bundler must leave this import alone.
const MODULE = "/js/terrain-field.js";

export function CalmField() {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(({ g, still, intro }) => {
    const el = ref.current;
    if (!el || !webgl2()) return;
    let dead = false;
    let field: FieldLike | null = null;
    let tick: (() => void) | null = null;
    calm.drops = [];
    calm.on = still || !intro ? 1 : 0;
    (import(/* webpackIgnore: true */ /* turbopackIgnore: true */ MODULE) as Promise<FieldModule>)
      .then((mod) => {
        if (dead) return;
        field = mod.calmField(el, calm, { still });
        start(g, el, still || !intro);
        let last = performance.now();
        tick = () => {
          const now = performance.now();
          const dt = still ? 0 : Math.min(0.05, (now - last) / 1000);
          last = now;
          field?.frame(dt, now / 1000);
        };
        g.ticker.add(tick);
      })
      .catch((err) => console.warn("Terrain unavailable", err));
    return () => {
      dead = true;
      if (tick) g.ticker.remove(tick);
      g.killTweensOf([el, calm]);
      field?.dispose();
    };
  }, []);
  return <div ref={ref} className="va-field" aria-hidden="true" />;
}

/** The hero's terrain entrance: the canvas fades in (1.6s) while the field rises from flat (2.6s). */
function start(g: Gsap, el: HTMLElement, settled: boolean) {
  if (settled) return;
  g.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.6, ease: "power2.out" });
  g.to(calm, { on: 1, duration: 2.6, ease: "power3.inOut" });
}
