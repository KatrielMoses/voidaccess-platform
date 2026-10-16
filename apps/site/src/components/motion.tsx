"use client";

import { useRef } from "react";
import { EASE, LOW, magnetic, useMotion, type Gsap, type Split, type Tween } from "@/lib/motion";

/**
 * Page entrances in the home page's choreography (public/js/app.js, design.md §8). Renders nothing: it animates the
 * marked elements inside its parent.
 *
 *   [data-va-idx]           section index: its rule draws, then the label scrambles in
 *   [data-va-split="title"] heading lines rise through masks
 *   [data-va-split="lede"]  lede lines rise through masks
 *   [data-va-up]            fades up 16px
 *   [data-va-mag]           magnetic (0.28); "block" = a full-width button, travel capped
 *
 * entrance="load" is the hero's load sequence (headline 0.5s, lede 0.85s, the rest 1.0s); "step" is a section-head
 * entrance for content that replaces other content (the sign-in code step): title rises, lede follows, the rest
 * cross-fades in. Under ?static or prefers-reduced-motion nothing plays and everything is in its final state.
 */
export function Reveal({ entrance = "load" }: { entrance?: "load" | "step" }) {
  const ref = useRef<HTMLSpanElement>(null);
  useMotion(
    ({ g, SplitText, still, intro }) => {
      const root = ref.current?.parentElement;
      if (!root || still) return;
      const q = (s: string) => Array.from(root.querySelectorAll<HTMLElement>(s));
      const unmag = magnetic(g, q("[data-va-mag]:not([data-va-mag=block])"));
      const unmagBlock = magnetic(g, q("[data-va-mag=block]"), 0.28, 6);
      const step = entrance === "step";
      if (!step && !intro) {
        return () => {
          unmag();
          unmagBlock();
        };
      }
      const tweens: Tween[] = [];
      const splits: Split[] = [];
      const lines = (sel: string, from: { yPercent: number; duration: number; stagger: number; delay: number }) =>
        q(sel).forEach((el) =>
          splits.push(
            SplitText.create(el, {
              type: "lines",
              mask: "lines",
              linesClass: "va-line",
              autoSplit: true,
              aria: "none", // lines never break words, so the text reads as before
              onSplit(self: Split) {
                g.set(el, { autoAlpha: 1 });
                return g.from(self.lines, { ...from, ease: EASE.out });
              },
            }),
          ),
        );
      tweens.push(...indexes(g, q("[data-va-idx]"), step ? 0 : 0.3));
      lines(
        '[data-va-split="title"]',
        step ? { yPercent: 110, duration: 1.3, stagger: 0.1, delay: 0.05 } : { yPercent: 118, duration: 1.4, stagger: 0.12, delay: 0.5 },
      );
      lines(
        '[data-va-split="lede"]',
        step ? { yPercent: 105, duration: 1.2, stagger: 0.06, delay: 0.2 } : { yPercent: 105, duration: 1.2, stagger: 0.06, delay: 0.85 },
      );
      const ups = q("[data-va-up]");
      if (ups.length)
        tweens.push(
          step
            ? // opacity only: the code field is autofocused, and visibility:hidden would take the focus away
              g.fromTo(
                ups,
                { opacity: 0, y: 10 },
                {
                  opacity: 1,
                  y: 0,
                  duration: 0.7,
                  stagger: 0.05,
                  delay: 0.25,
                  ease: EASE.out,
                  clearProps: "opacity,transform,translate",
                },
              )
            : g.fromTo(
                ups,
                { autoAlpha: 0, y: 16 },
                {
                  autoAlpha: 1,
                  y: 0,
                  duration: 1.2,
                  stagger: 0.1,
                  delay: 1.0,
                  ease: EASE.out,
                  clearProps: "opacity,visibility,transform,translate",
                },
              ),
        );
      return () => {
        tweens.forEach((t) => t.kill());
        splits.forEach((s) => s.revert());
        unmag();
        unmagBlock();
      };
    },
    [entrance],
  );
  return <span ref={ref} hidden />;
}

/** The home's section index: the 28px rule draws (1.2s), then the label scrambles in (0.9s). */
function indexes(g: Gsap, els: HTMLElement[], at: number): Tween[] {
  return els.flatMap((el) => {
    const rule = el.querySelector("i");
    const label = el.querySelector<HTMLElement>("[data-t]");
    g.set(el, { autoAlpha: 1 });
    const out: Tween[] = [];
    if (rule) out.push(g.fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: 1.2, delay: at, ease: "expo.inOut" }));
    if (label) {
      const text = label.dataset.t ?? "";
      label.textContent = "";
      out.push(
        g.to(label, {
          duration: 0.9,
          delay: at + 0.2,
          ease: "power1.inOut",
          scrambleText: { text, chars: LOW, speed: 0.45, tweenLength: true },
        }),
      );
    }
    return out;
  });
}

/** The home's section index markup: a 28px rule, then a mono label. */
export function Index({ label, decorative = false }: { label: string; decorative?: boolean }) {
  return (
    <p className="va-idx" data-va-idx data-va-pre aria-hidden={decorative || undefined}>
      <i />
      <span data-t={label}>{label}</span>
    </p>
  );
}
