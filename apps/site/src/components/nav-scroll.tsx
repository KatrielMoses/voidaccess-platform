"use client";

import { useEffect, useRef } from "react";
import { magnetic, useMotion } from "@/lib/motion";

/**
 * The home page's nav behaviour (design.md §6): transparent at the top, solid after 12px of scroll, hidden on downward
 * scroll past 520px and back on upward scroll. Renders nothing; it toggles classes on the parent <nav>.
 * On load the nav items drop in like the home page's (1.1s, 0.07s stagger, from 0.3s), and "Start free" is magnetic.
 */
export function NavScroll() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const nav = ref.current?.parentElement;
    if (!nav) return;
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      nav.classList.toggle("solid", y > 12);
      nav.classList.toggle("hide", y > 520 && y > last && !nav.contains(document.activeElement));
      last = y;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useMotion(({ g, still, intro }) => {
    const nav = ref.current?.parentElement;
    if (!nav || still) return;
    const items = Array.from(nav.querySelectorAll("[data-va-pre]"));
    const t = intro ? g.fromTo(items, { autoAlpha: 0, y: -10 }, { autoAlpha: 1, y: 0, duration: 1.1, stagger: 0.07, delay: 0.3, ease: "expo.out" }) : null;
    const off = magnetic(g, Array.from(nav.querySelectorAll("[data-va-mag]")));
    return () => {
      t?.kill();
      off();
    };
  }, []);
  return <span ref={ref} hidden />;
}
