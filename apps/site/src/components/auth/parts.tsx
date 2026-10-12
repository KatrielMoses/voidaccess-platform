import Link from "next/link";
import type { InputHTMLAttributes, ReactNode } from "react";

const input =
  "w-full min-h-11 rounded-lg border border-border-strong bg-void px-3.5 py-2.5 text-fg placeholder:text-fg-secondary focus:border-accent";

export function AuthCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-border-subtle bg-surface p-6 sm:p-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      {description ? <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{description}</p> : null}
      <div className="mt-6 flex flex-col gap-4">{children}</div>
    </div>
  );
}

export function Field({ label, id, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input id={id} name={id} aria-describedby={hint ? `${id}-hint` : undefined} className={input} {...props} />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-fg-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

export function FormNotice({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
      {message}
    </p>
  );
}

const btn =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export function SubmitButton({ busy, disabled, children }: { busy?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy || disabled} className={`${btn} bg-accent text-fg-inverse hover:bg-white`}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`${btn} border border-border-strong text-fg hover:border-accent-border hover:bg-accent-dim`} {...props}>
      {children}
    </button>
  );
}

export function TextLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`text-sm text-accent underline underline-offset-4 ${className}`}>
      {children}
    </Link>
  );
}
