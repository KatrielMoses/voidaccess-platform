import { cn } from "@voidaccess/ui";
import { typeStyle } from "@/lib/results/entity-style";
import { TypeGlyph } from "./type-glyph";

/** Entity type as a mono label with the graph's glyph: text and shape, never colour. */
export function TypeBadge({ type, className }: { type: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 font-mono text-[12px] leading-none whitespace-nowrap text-dim",
        className,
      )}
    >
      <TypeGlyph type={type} className="text-paper/80" />
      <span className="truncate">{typeStyle(type).label}</span>
    </span>
  );
}
