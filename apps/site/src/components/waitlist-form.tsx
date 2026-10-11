"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { getFirstTouch, track } from "@/lib/analytics";

interface Props {
  labels: {
    email: string;
    role: string;
    roles: string[];
    useCase: string;
    useCasePlaceholder: string;
    founding: string;
    consent: string;
    submit: string;
    submitting: string;
    privacy: string;
    errors: Record<string, string>;
  };
  defaultFounding: boolean;
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

const field =
  "mt-1.5 w-full min-h-11 rounded-lg border border-border-strong bg-void px-3.5 py-2.5 text-fg placeholder:text-fg-secondary focus:border-accent";

export function WaitlistForm({ labels, defaultFounding }: Props) {
  const router = useRouter();
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string>(undefined);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const mount = () => {
      if (cancelled || !widget.current || !window.turnstile || widgetId.current) return;
      widgetId.current = window.turnstile.render(widget.current, {
        sitekey: SITE_KEY,
        theme: "dark",
        callback: (t: string) => setToken(t),
        "expired-callback": () => setToken(""),
        "error-callback": () => setToken(""),
      });
    };
    if (window.turnstile) mount();
    else {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = mount;
      document.head.appendChild(s);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const touch = getFirstTouch();
    const wantsFounding = fd.get("wantsFounding") === "on";
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: fd.get("email"),
          role: fd.get("role") || undefined,
          useCase: fd.get("useCase") || undefined,
          wantsFounding,
          consentMarketing: fd.get("consentMarketing") === "on",
          website: fd.get("website") || undefined,
          refCode: touch.ref,
          firstTouch: touch,
          turnstileToken: token,
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (res.ok && json?.ok) {
        track("waitlist_joined", { founding: String(wantsFounding), ...(touch.utm_source ? { utm_source: touch.utm_source } : {}), ...(touch.ref ? { ref: touch.ref } : {}) });
        router.push("/waitlist/check-email");
        return;
      }
      setError(labels.errors[json?.error ?? "network"] ?? labels.errors.network ?? "Error");
      window.turnstile?.reset(widgetId.current);
      setToken("");
    } catch {
      setError(labels.errors.network ?? "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate={false}>
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          {labels.email}
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" maxLength={254} className={field} />
      </div>
      <div>
        <label htmlFor="role" className="block text-sm font-medium">
          {labels.role}
        </label>
        <select id="role" name="role" defaultValue="" className={field}>
          <option value="" />
          {labels.roles.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="useCase" className="block text-sm font-medium">
          {labels.useCase}
        </label>
        <textarea id="useCase" name="useCase" rows={3} maxLength={500} placeholder={labels.useCasePlaceholder} className={field} />
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="wantsFounding" defaultChecked={defaultFounding} className="mt-1 size-5 accent-[var(--color-accent)]" />
        <span>{labels.founding}</span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="consentMarketing" className="mt-1 size-5 accent-[var(--color-accent)]" />
        <span>{labels.consent}</span>
      </label>
      {/* honeypot */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div ref={widget} className="min-h-[65px]" data-testid="turnstile" />
      <button
        type="submit"
        disabled={busy || !token}
        className="min-h-11 w-full rounded-lg bg-accent px-5 py-3 font-semibold text-fg-inverse transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? labels.submitting : labels.submit}
      </button>
      <p role="alert" className="min-h-5 text-sm text-danger">
        {error}
      </p>
      <p className="text-xs leading-relaxed text-fg-secondary">{labels.privacy}</p>
    </form>
  );
}
