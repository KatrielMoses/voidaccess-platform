import * as React from "react";
import { cn } from "@voidaccess/ui";

/**
 * Page head (design.md §4–5): an optional mono index after a 28px rule, a General Sans 500 title with tight tracking,
 * an optional dim lede, and actions on the right.
 */
export function PageHeader({
  title,
  index,
  lede,
  actions,
  className,
  titleTestId,
}: {
  title: React.ReactNode;
  index?: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  titleTestId?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-10 gap-y-6", className)}>
      <div className="flex max-w-[52rem] min-w-0 flex-col gap-4">
        {index ? <Index>{index}</Index> : null}
        <h1
          className="text-[clamp(32px,3.2vw,44px)] leading-[1.02] font-medium tracking-[-0.04em] break-words text-paper"
          data-testid={titleTestId}
        >
          {title}
        </h1>
        {lede ? <div className="max-w-[60ch] text-[17px] leading-[1.55] text-dim">{lede}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </header>
  );
}

/** The section index: mono 13px in dim after a 28px `line-3` rule. */
export function Index({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-center gap-3 font-mono text-[13px] leading-none text-dim", className)}>
      <i aria-hidden className="inline-block h-px w-7 bg-line-3" />
      {children}
    </p>
  );
}

/**
 * A settings-style row: hairline on top, title and note on the left (4 of 12 columns), content on the right.
 * Collapses to one column at 960px.
 */
export function Row({
  title,
  note,
  children,
  className,
  testId,
  id,
}: {
  title: React.ReactNode;
  note?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      data-testid={testId}
      className={cn(
        "grid grid-cols-12 gap-x-6 gap-y-5 border-t border-line pt-7 pb-10 max-[960px]:grid-cols-1",
        className,
      )}
    >
      <div className="col-span-4 flex flex-col gap-2 max-[960px]:col-span-1">
        <h2 className="text-[21px] leading-[1.15] font-medium tracking-[-0.02em] text-paper">{title}</h2>
        {note ? <div className="max-w-[40ch] text-[15px] leading-[1.55] text-dim">{note}</div> : null}
      </div>
      <div className="col-span-8 flex min-w-0 flex-col gap-4 max-[960px]:col-span-1">{children}</div>
    </section>
  );
}

/** Section title for stacked content (smaller than the page title). */
export function SectionTitle({
  children,
  id,
  className,
}: {
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <h2
      id={id}
      className={cn(
        "text-[clamp(23px,2vw,28px)] leading-[1.1] font-medium tracking-[-0.03em] text-paper",
        className,
      )}
    >
      {children}
    </h2>
  );
}

/** Notice block: raised ink with a hairline, paper text, an optional mono marker. No colour bars. */
export function Notice({
  children,
  mark,
  tone = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { mark?: string; tone?: "default" | "quiet" }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-bg-2 px-4 py-3.5 text-[15px] leading-[1.55]",
        tone === "quiet" ? "border-line text-dim" : "border-line-2 text-paper",
        className,
      )}
      {...props}
    >
      {mark ? (
        <span aria-hidden className="pt-[2px] font-mono text-[12px] leading-5 text-paper">
          {mark}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </div>
  );
}
