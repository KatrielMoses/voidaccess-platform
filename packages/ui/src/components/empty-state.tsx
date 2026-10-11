import * as React from "react";
import { cn } from "../lib/cn";

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? <div className="text-3xl text-fg-muted">{icon}</div> : null}
      <h3 className="font-display text-lg font-semibold text-fg">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-fg-secondary">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
