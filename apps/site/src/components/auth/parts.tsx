"use client";

import Link from "next/link";
import { useRef, type InputHTMLAttributes, type ReactNode } from "react";
import { useMotion } from "@/lib/motion";
import { Index, Reveal } from "../motion";

/**
 * Building blocks for the sign-in page, in the design system (design.md): paper-block inputs, one filled violet
 * button per view, outline buttons for everything else, and no status colours (errors are words, not red).
 * Elements marked data-va-up / data-va-mag take part in the page's entrance and micro-interactions (components/motion).
 */
export function AuthCard({
  index,
  title,
  description,
  entrance = "load",
  children,
}: {
  index?: string;
  title: string;
  description?: ReactNode;
  entrance?: "load" | "step";
  children: ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 gap-y-12 pt-14 pb-10 min-[961px]:grid-cols-12 min-[961px]:pt-[78px] min-[961px]:pb-16">
      <Reveal entrance={entrance} />
      <div className="min-[961px]:col-span-6">
        {index ? (
          <div className="mb-8">
            <Index label={index} decorative />
          </div>
        ) : null}
        <h1 className="va-title" data-va-split="title">
          {title}
        </h1>
        {description ? (
          <p className="va-lede mt-6 max-w-[34ch]" data-va-split="lede">
            {description}
          </p>
        ) : null}
      </div>
      {/* the same height on both steps, so the field below stays put when the step changes */}
      <div className="flex flex-col gap-6 min-[961px]:col-start-8 min-[961px]:col-end-13 min-[961px]:min-h-[452px] min-[961px]:pt-2">{children}</div>
    </section>
  );
}

export function Field({ label, id, hint, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string }) {
  return (
    <div data-va-up>
      <label htmlFor={id} className="va-label">
        {label}
      </label>
      <input id={id} name={id} aria-describedby={hint ? `${id}-hint` : undefined} className={className ? `va-input ${className}` : "va-input"} {...props} />
      {hint ? (
        <p id={`${id}-hint`} className="mt-2 text-[15px] text-mute">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Messages fade in (expo.out) rather than appear. */
function useFadeIn(message?: string | null) {
  const ref = useRef<HTMLParagraphElement>(null);
  useMotion(
    ({ g, still }) => {
      const el = ref.current;
      if (!el || still) return;
      const t = g.fromTo(el, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.7, ease: "expo.out", clearProps: "opacity,transform,translate" });
      return () => t.kill();
    },
    [message],
  );
  return ref;
}

export function FormError({ message }: { message?: string | null }) {
  const ref = useFadeIn(message);
  if (!message) return null;
  return (
    <p ref={ref} role="alert" className="rounded-sm border border-line-2 px-4 py-3 text-[15px] leading-normal text-paper">
      {message}
    </p>
  );
}

export function FormNotice({ message }: { message?: string | null }) {
  const ref = useFadeIn(message);
  if (!message) return null;
  return (
    <p ref={ref} role="status" className="text-[15px] leading-normal text-dim">
      {message}
    </p>
  );
}

/** The view's one violet thing: filled v-600, v-700 on hover, with the design's arrow swap. */
export function SubmitButton({ busy, disabled, children }: { busy?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    // the wrapper fades in with the page; the button itself is magnetic (two transforms, two elements)
    <div data-va-up>
      <button type="submit" disabled={busy || disabled} aria-busy={busy || undefined} className="va-btn va-btn-primary va-btn-block" data-va-mag="block">
        <span>{children}</span>
        <span className="va-arr" aria-hidden="true" />
      </button>
    </div>
  );
}

export function SecondaryButton({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`va-btn va-btn-line va-btn-block ${className ?? ""}`} data-va-mag="block" {...props}>
      <span>{children}</span>
    </button>
  );
}

export function TextLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`va-tl ${className}`}>
      {children}
    </Link>
  );
}
