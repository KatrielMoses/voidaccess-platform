"use client";

import { useEffect, useRef } from "react";

/**
 * The home page's nav behaviour (design.md §6): transparent at the top, solid after 12px of scroll, hidden on downward
 * scroll past 520px and back on upward scroll. Renders nothing; it toggles classes on the parent <nav>.
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
  return <span ref={ref} hidden />;
}
