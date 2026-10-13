import Link from "next/link";
import { Badge, cn, type BadgeVariant } from "@voidaccess/ui";

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
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 max-w-3xl text-sm text-fg-secondary">{subtitle}</p> : null}
        </div>
        {actions}
      </header>
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
    <section data-testid={testId} className="flex flex-col gap-3">
      <div>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {hint ? <p className="text-sm text-fg-secondary">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

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
    <div data-testid={testId} className="rounded-lg border border-border-subtle bg-surface px-4 py-3">
      <p className="text-xs tracking-wide text-fg-secondary uppercase">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-fg-secondary">{sub}</p> : null}
    </div>
  );
}

/** Horizontal CSS bar, `value` of `max`. */
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
    <div className="h-2 w-full overflow-hidden rounded-full bg-raised" role="img" aria-label={label}>
      <div className={cn("h-full rounded-full bg-accent", className)} style={{ width: `${w}%` }} />
    </div>
  );
}

/** Stacked bar from segments. */
export function Stack({ parts }: { parts: Array<{ label: string; n: number; className: string }> }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-raised"
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
  active: "success",
  suspended: "warning",
  banned: "danger",
  admin: "accent",
  user: "default",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
  open: "warning",
  reviewed: "success",
  dismissed: "neutral",
  actioned: "accent",
};
export const StateBadge = ({ value }: { value: string }) => (
  <Badge variant={STATUS_VARIANT[value] ?? "default"}>{value}</Badge>
);

export const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-lg border border-dashed border-border-subtle px-4 py-6 text-center text-sm text-fg-secondary">
    {children}
  </p>
);

export const UserLink = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <Link href={`/admin/users/${id}`} className="text-accent underline-offset-2 hover:underline">
    {children}
  </Link>
);

/** Table scaffolding with the app's tokens (plain elements: the ui Table wrapper adds nothing these need). */
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
    <div className="w-full overflow-x-auto rounded-lg border border-border-subtle">
      <table data-testid={testId} className="w-full border-collapse text-left text-sm">
        <thead className="bg-surface text-fg-secondary">
          <tr>
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="h-9 border-b border-border-subtle px-3 text-xs font-medium tracking-wide uppercase whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-dim">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-3 py-2 align-top", className)} {...p}>
    {children}
  </td>
);
