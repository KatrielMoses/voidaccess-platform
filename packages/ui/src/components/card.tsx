import * as React from "react";
import { cn } from "../lib/cn";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * A hairline section, not a box (design.md §5 "hairlines over boxes"): a 1px `line` rule on top, no fill, no radius.
 * For card grids use the 1px-gap-on-line technique (`grid gap-px bg-line border border-line` with `bg-bg` cells).
 */
export function Card({ className, ...props }: DivProps) {
  return <div className={cn("border-t border-line text-paper", className)} {...props} />;
}

export function CardHeader({ className, ...props }: DivProps) {
  return <div className={cn("flex flex-col gap-1.5 pt-6 pb-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "font-sans text-[21px] leading-[1.15] font-medium tracking-[-0.02em] text-paper",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-[15px] leading-[1.55] text-dim", className)} {...props} />;
}

export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn("pb-6", className)} {...props} />;
}

export function CardFooter({ className, ...props }: DivProps) {
  return <div className={cn("flex items-center gap-2 border-t border-line py-4", className)} {...props} />;
}
