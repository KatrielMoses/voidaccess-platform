import * as React from "react";
import { cn } from "../lib/cn";

/** Hairline-ruled, left-aligned, calm: what will appear here and the next step. */
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
    <div className={cn("flex flex-col items-start gap-3 border-y border-line py-14", className)}>
      {icon ? <div className="font-mono text-[13px] text-mute">{icon}</div> : null}
      <h3 className="text-[23px] leading-[1.15] font-medium tracking-[-0.025em] text-paper">{title}</h3>
      {description ? <p className="max-w-[46ch] text-[15px] leading-[1.55] text-dim">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
