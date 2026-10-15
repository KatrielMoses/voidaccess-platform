import * as React from "react";
import { cn } from "../lib/cn";

/**
 * Inputs are paper blocks (design.md §3.2): paper fill, ink text, stone placeholder, 6px radius, border v-600 on focus.
 * The global focus ring stays on top of that.
 */
export const inputClass =
  "w-full rounded-lg border border-paper bg-paper px-4 font-sans text-[15px] text-ink placeholder:text-stone transition-[border-color] duration-300 ease-out [color-scheme:light] hover:border-paper-2 focus:border-v-600 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-ink";

export function Input({
  className,
  ref,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cn(inputClass, "h-[46px]", className)} {...props} />;
}

export function Textarea({
  className,
  ref,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: React.Ref<HTMLTextAreaElement>;
}) {
  return (
    <textarea ref={ref} className={cn(inputClass, "min-h-24 py-3 leading-[1.5]", className)} {...props} />
  );
}

/** A native <select> as a paper block, with a stone chevron. Light colour-scheme so the OS list stays readable. */
export function NativeSelect({
  className,
  ref,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { ref?: React.Ref<HTMLSelectElement> }) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        ref={ref}
        className={cn(inputClass, "h-[46px] cursor-pointer appearance-none pr-10")}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        className="pointer-events-none absolute top-1/2 right-4 size-3 -translate-y-1/2 text-stone"
      >
        <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    </span>
  );
}
