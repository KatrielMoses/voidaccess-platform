"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { TURNSTILE_SITE_KEY } from "@/lib/auth/config";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

/**
 * Explicit-render Turnstile widget (same pattern as the waitlist form). Reports the token, or "" when it expires.
 * The server (the app) verifies the token; `resetRef.current()` re-arms the widget after a failed attempt.
 */
export function Turnstile({ onToken, resetRef }: { onToken: (token: string) => void; resetRef?: MutableRefObject<() => void> }) {
  const el = useRef<HTMLDivElement>(null);
  const id = useRef<string>(undefined);
  const cb = useRef(onToken);
  useEffect(() => {
    cb.current = onToken;
  });

  useEffect(() => {
    let cancelled = false;
    const mount = () => {
      if (cancelled || !el.current || !window.turnstile || id.current) return;
      id.current = window.turnstile.render(el.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "dark",
        callback: (t: string) => cb.current(t),
        "expired-callback": () => cb.current(""),
        "error-callback": () => cb.current(""),
      });
    };
    if (resetRef) {
      resetRef.current = () => {
        window.turnstile?.reset(id.current);
        cb.current("");
      };
    }
    if (window.turnstile) mount();
    else {
      const existing = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
      const s = existing ?? document.createElement("script");
      if (!existing) {
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true;
        s.dataset.turnstile = "1";
        document.head.appendChild(s);
      }
      s.addEventListener("load", mount);
    }
    return () => {
      cancelled = true;
    };
  }, [resetRef]);

  return <div ref={el} className="min-h-[65px]" data-testid="turnstile" data-va-up />;
}
