import { useLayoutEffect, type DependencyList } from "react";

/**
 * Motion for the React pages (sign-in, pricing, legal, 404), in the home page's language (design.md §8).
 *
 * The libraries are the home page's own vendored files (public/vendor: GSAP 3.15.0, SplitText, ScrambleText), loaded
 * once per document as classic scripts, in order. Same bytes as the home page, so a visitor coming from `/` already has
 * them cached; no npm copy that could drift from the home page's version; and three.js has to come from /vendor
 * anyway for the terrain (public/js/terrain-field.js). Everything runs on GSAP's ticker: one animation loop.
 *
 * Content is never hidden behind motion. The inline script in the root layout (MOTION_BOOT, lib/motion-boot.ts) adds `va-m` to <html>
 * only when motion is allowed (not `?static`, not prefers-reduced-motion); while it is set, `[data-va-pre]` and
 * `[data-va-split]` are hidden (globals.css). When the libraries are ready the intro builds its start states inline and
 * the class is removed in the same frame. If they fail to load, or take longer than 4s, the class is dropped and the
 * page shows its final state. Without JavaScript the class is never set.
 */

type Target = Element | Element[] | NodeListOf<Element> | string | object | null;
export type Vars = Record<string, unknown>;
export interface Tween {
  kill(): void;
}
export interface Timeline extends Tween {
  to(t: Target, v: Vars, at?: number | string): Timeline;
  fromTo(t: Target, from: Vars, to: Vars, at?: number | string): Timeline;
  add(x: Tween | (() => void), at?: number | string): Timeline;
}
export interface Gsap {
  to(t: Target, v: Vars): Tween;
  from(t: Target, v: Vars): Tween;
  fromTo(t: Target, from: Vars, to: Vars): Tween;
  set(t: Target, v: Vars): Tween;
  timeline(v?: Vars): Timeline;
  quickTo(t: Target, prop: string, v?: Vars): (value: number) => void;
  killTweensOf(t: Target): void;
  registerPlugin(...plugins: unknown[]): void;
  ticker: { add(fn: () => void): void; remove(fn: () => void): void };
}
export interface Split {
  lines: Element[];
  revert(): void;
}
interface SplitTextStatic {
  create(el: Element, v: Vars): Split;
}
declare global {
  interface Window {
    gsap?: Gsap;
    SplitText?: SplitTextStatic;
    ScrambleTextPlugin?: unknown;
  }
}

export interface Motion {
  g: Gsap;
  SplitText: SplitTextStatic;
  /** `?static` or prefers-reduced-motion: render final states, play nothing. */
  still: boolean;
  /** Entrances may play (not still, and the page was not already revealed by the 4s fail-safe). */
  intro: boolean;
}

const VENDOR = ["/vendor/gsap.min.js", "/vendor/SplitText.min.js", "/vendor/ScrambleTextPlugin.min.js"];
export const EASE = { out: "expo.out", io: "power3.inOut", soft: "power2.out" } as const;
/** The home page's scramble alphabet (app.js). */
export const LOW = "acemnorsuvwxz";

let state: "idle" | "loading" | "ready" | "off" = "idle";
let motion: Motion | null = null;
let queue: ((m: Motion) => void)[] = [];

export function isStill(): boolean {
  return /[?&]static/.test(location.search) || matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function reveal() {
  document.documentElement.classList.remove("va-m");
}

function finish() {
  const g = window.gsap;
  const SplitText = window.SplitText;
  if (!g || !SplitText) return fail();
  g.registerPlugin(SplitText, window.ScrambleTextPlugin);
  const fonts = document.fonts?.ready ?? Promise.resolve();
  fonts.then(() =>
    requestAnimationFrame(() => {
      const still = isStill();
      // The fail-safe already showed the page: don't hide it again to play an entrance.
      const intro = !still && document.documentElement.classList.contains("va-m");
      motion = { g, SplitText, still, intro };
      state = "ready";
      const q = queue;
      queue = [];
      // Every waiting entrance sets its start state inline now, then the page-wide hide is lifted (same frame).
      for (const fn of q) fn(motion);
      reveal();
      motion = { ...motion, intro: !still };
    }),
  );
}

function fail() {
  state = "off";
  queue = [];
  reveal();
}

function load() {
  if (state !== "idle") return;
  state = "loading";
  if (window.gsap && window.SplitText && window.ScrambleTextPlugin) return finish();
  let left = VENDOR.length;
  for (const src of VENDOR) {
    const s = document.createElement("script");
    s.src = src;
    s.async = false; // dynamically inserted scripts run in insertion order
    s.onload = () => {
      if (--left === 0) finish();
    };
    s.onerror = fail;
    document.head.appendChild(s);
  }
}

/** Calls fn with the motion kit once it is loaded (synchronously if it already is). Never calls it if loading failed. */
export function whenMotion(fn: (m: Motion) => void) {
  if (state === "ready" && motion) return fn(motion);
  if (state === "off") return;
  queue.push(fn);
  load();
}

/**
 * useLayoutEffect + the motion kit: runs before paint (so start states never flash), and the returned function cleans
 * up on unmount or when deps change.
 */
export function useMotion(fn: (m: Motion) => void | (() => void), deps: DependencyList) {
  useLayoutEffect(() => {
    let alive = true;
    let cleanup: void | (() => void);
    whenMotion((m) => {
      if (alive) cleanup = fn(m);
    });
    return () => {
      alive = false;
      if (cleanup) cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller passes the deps
  }, deps);
}

/** A plain promise for an exit animation: resolves at once when motion is unavailable or still. */
export function leave(el: Element | null): Promise<void> {
  return new Promise((resolve) => {
    if (!el || state !== "ready" || !motion || motion.still) return resolve();
    motion.g.to(el, {
      opacity: 0,
      y: -6,
      duration: 0.2,
      ease: "power2.in",
      overwrite: true,
      onComplete: () => resolve(),
    });
  });
}

/**
 * The home page's magnetic buttons (motion.js VA.magnetic): they lean toward the pointer, strength 0.28, pointer
 * devices only. `cap` limits the travel in px for full-width buttons, where 0.28 of half their width would be too far.
 */
export function magnetic(g: Gsap, els: Element[], k = 0.28, cap = Infinity): () => void {
  if (matchMedia("(hover: none)").matches) return () => {};
  const off: (() => void)[] = [];
  for (const el of els as HTMLElement[]) {
    const xTo = g.quickTo(el, "x", { duration: 0.6, ease: "power3.out" });
    const yTo = g.quickTo(el, "y", { duration: 0.6, ease: "power3.out" });
    const clamp = (v: number) => Math.max(-cap, Math.min(cap, v));
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      xTo(clamp((e.clientX - r.left - r.width / 2) * k));
      yTo(clamp((e.clientY - r.top - r.height / 2) * k));
    };
    const out = () => {
      xTo(0);
      yTo(0);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", out);
    off.push(() => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", out);
      g.set(el, { clearProps: "transform,translate" });
    });
  }
  return () => off.forEach((f) => f());
}
