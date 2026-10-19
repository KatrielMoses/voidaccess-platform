import { adminHref } from "@/lib/admin/path";
import Link from "next/link";
import { Badge, cn, type BadgeVariant } from "@voidaccess/ui";
import { PageHeader, SectionTitle } from "@/components/page-header";

export function Page({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="va-rise flex flex-col gap-12">
      <PageHeader title={title} lede={subtitle} actions={actions} />
      {children}
    </div>
  );
}

export function Section({
  title,
  hint,
  children,
  testId,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-2">
        <SectionTitle className="text-[21px] tracking-[-0.02em]">{title}</SectionTitle>
        {hint ? <p className="max-w-[72ch] text-[15px] leading-[1.55] text-dim">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A meter cell (design.md §6 pipeline meters): mono label, mono value with tabular numerals. Use inside <StatGrid>. */
export function Stat({
  label,
  value,
  sub,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="flex flex-col gap-4 bg-bg p-6 max-[960px]:p-5">
      <p className="font-mono text-[12px] leading-none text-mute">{label}</p>
      <p className="font-mono text-[28px] leading-none tracking-[-0.04em] break-words text-paper tabular-nums max-[960px]:text-[20px]">
        {value}
      </p>
      {sub ? <p className="font-mono text-[12px] leading-[1.4] text-dim">{sub}</p> : null}
    </div>
  );
}

/** Card grid by the 1px-gap-on-line technique, so every border is exactly one hairline. */
export function StatGrid({ children, cols = 4 }: { children: React.ReactNode; cols?: 3 | 4 }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line",
        cols === 4 ? "md:grid-cols-4" : "md:grid-cols-3",
      )}
    >
      {children}
    </div>
  );
}

/** Horizontal bar, `value` of `max`: a hairline track with a paper fill. */
export function Bar({
  value,
  max,
  className,
  label,
}: {
  value: number;
  max: number;
  className?: string;
  label?: string;
}) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-1 w-full bg-paper/[.08]" role="img" aria-label={label}>
      <div className={cn("h-full bg-paper", className)} style={{ width: `${w}%` }} />
    </div>
  );
}

/** Stacked bar from segments. Segments differ by paper opacity; only live work may use the v-500 signal. */
export function Stack({ parts }: { parts: Array<{ label: string; n: number; className: string }> }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  return (
    <div
      className="flex h-1.5 w-full gap-px overflow-hidden bg-paper/[.08]"
      role="img"
      aria-label={parts.map((p) => `${p.label} ${p.n}`).join(", ")}
    >
      {parts.map((p) =>
        p.n > 0 ? (
          <div
            key={p.label}
            className={p.className}
            style={{ width: `${(p.n / total) * 100}%` }}
            title={`${p.label}: ${p.n}`}
          />
        ) : null,
      )}
    </div>
  );
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: "strong",
  suspended: "outline",
  banned: "outline",
  admin: "strong",
  user: "default",
  completed: "strong",
  failed: "outline",
  cancelled: "quiet",
  open: "outline",
  reviewed: "default",
  dismissed: "quiet",
  actioned: "strong",
};
const STATUS_MARK: Record<string, string> = { suspended: "!", banned: "✕", failed: "✕", open: "!" };
export const StateBadge = ({ value }: { value: string }) => (
  <Badge variant={STATUS_VARIANT[value] ?? "default"}>
    {STATUS_MARK[value] ? <span aria-hidden>{STATUS_MARK[value]}</span> : null}
    {value}
  </Badge>
);

export const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="border-y border-line py-7 text-[15px] text-dim">{children}</p>
);

export const UserLink = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <Link href={adminHref(`/users/${id}`)} className="va-link">
    {children}
  </Link>
);

/** Hairline table with mono column labels in sentence case (plain elements, so the dense admin views stay compact). */
export function T({
  head,
  children,
  testId,
}: {
  head: string[];
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table
        data-testid={testId}
        className="w-full border-collapse text-left text-[15px] [&>tbody>tr]:border-b [&>tbody>tr]:border-line [&>tbody>tr]:transition-colors [&>tbody>tr]:duration-300 [&>tbody>tr:hover]:bg-bg-2"
      >
        <thead>
          <tr className="border-b border-line">
            {head.map((h, i) => (
              <th
                key={`${h}-${i}`}
                scope="col"
                className="h-11 px-3 font-mono text-[12px] font-normal whitespace-nowrap text-mute first:pl-0"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-3 py-3 align-top first:pl-0", className)} {...p}>
    {children}
  </td>
);

/** Numbers in tables: mono, tabular. */
export const Num = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn("font-mono text-[13px] tabular-nums", className)}>{children}</span>
);
