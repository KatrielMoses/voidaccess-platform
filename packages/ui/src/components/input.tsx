import * as React from "react";
import { cn } from "../lib/cn";

const field =
  "w-full rounded-md border border-border-subtle bg-surface px-3 text-sm text-fg placeholder:text-fg-muted transition-colors hover:border-border-strong focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent-border disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger";

export function Input({
  className,
  ref,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cn(field, "h-10", className)} {...props} />;
}

export function Textarea({
  className,
  ref,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: React.Ref<HTMLTextAreaElement>;
}) {
  return <textarea ref={ref} className={cn(field, "min-h-24 py-2", className)} {...props} />;
}
