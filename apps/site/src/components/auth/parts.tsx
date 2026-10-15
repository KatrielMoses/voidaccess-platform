import Link from "next/link";
import type { InputHTMLAttributes, ReactNode } from "react";

/**
 * Building blocks for the sign-in page, in the design system (design.md): paper-block inputs, one filled violet
 * button per view, outline buttons for everything else, and no status colours (errors are words, not red).
 */
export function AuthCard({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-y-12 pt-14 pb-28 min-[961px]:grid-cols-12 min-[961px]:pt-[132px] min-[961px]:pb-[168px]">
      <div className="min-[961px]:col-span-6">
        <h1 className="va-title">{title}</h1>
        {description ? <p className="va-lede mt-6 max-w-[34ch]">{description}</p> : null}
      </div>
      <div className="flex flex-col gap-6 min-[961px]:col-start-8 min-[961px]:col-end-13 min-[961px]:pt-2">{children}</div>
    </section>
  );
}

export function Field({ label, id, hint, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string }) {
  return (
    <div>
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

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-sm border border-line-2 px-4 py-3 text-[15px] leading-normal text-paper">
      {message}
    </p>
  );
}

export function FormNotice({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="text-[15px] leading-normal text-dim">
      {message}
    </p>
  );
}

/** The view's one violet thing: filled v-600, v-700 on hover, with the design's arrow swap. */
export function SubmitButton({ busy, disabled, children }: { busy?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy || disabled} aria-busy={busy || undefined} className="va-btn va-btn-primary va-btn-block">
      <span>{children}</span>
      <span className="va-arr" aria-hidden="true" />
    </button>
  );
}

export function SecondaryButton({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`va-btn va-btn-line va-btn-block ${className ?? ""}`} {...props}>
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
