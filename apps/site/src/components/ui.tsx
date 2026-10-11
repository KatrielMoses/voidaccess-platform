import Link from "next/link";
import type { ReactNode } from "react";

export function LinkButton({
  href,
  children,
  variant = "primary",
  external = false,
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  external?: boolean;
  className?: string;
}) {
  const base =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors";
  const styles = {
    primary: "bg-accent text-fg-inverse hover:bg-white",
    secondary: "border border-border-strong text-fg hover:border-accent-border hover:bg-accent-dim",
    ghost: "text-fg-secondary hover:text-fg",
  }[variant];
  const cls = `${base} ${styles} ${className}`;
  return external ? (
    <a href={href} className={cls} rel="noopener" target="_blank">
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

export function Section({
  id,
  children,
  className = "",
  tone = "plain",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  tone?: "plain" | "raised";
}) {
  return (
    <section id={id} className={`py-16 sm:py-24 ${tone === "raised" ? "border-y border-border-dim bg-surface" : ""} ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">{children}</p>;
}

export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
      {children}
    </h2>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-4 max-w-2xl text-lg leading-relaxed text-fg-secondary">{children}</p>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border-subtle bg-surface p-6 ${className}`}>{children}</div>;
}
