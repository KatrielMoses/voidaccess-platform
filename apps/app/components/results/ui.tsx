import { Tooltip, cn } from "@voidaccess/ui";

/**
 * Small building blocks for the results views, in the design.md language: hairlines, mono labels, text links
 * whose underline draws from the left (0.55s expo.out). No fills, no shadows, no hue.
 */

/** A text link or text button whose 1px underline draws in on hover. Paper by default. */
export const UL =
  "relative inline-flex items-center gap-1 text-paper transition-colors duration-300 after:absolute after:inset-x-0 after:-bottom-[3px] after:h-px after:origin-right after:scale-x-0 after:bg-current after:transition-transform after:duration-[550ms] after:ease-out hover:after:origin-left hover:after:scale-x-100 focus-visible:after:scale-x-100";

/** A mono value that acts as a link (neighbours, linked entities): paper, lavender on hover. */
export const VALUE_LINK =
  "min-w-0 truncate text-left font-mono text-[13px] text-paper underline decoration-line-2 underline-offset-[3px] transition-colors duration-300 hover:text-v-200 hover:decoration-v-200/60";

/** Section heading inside a panel or drawer. */
export const H = "text-[15px] font-medium tracking-[-0.01em] text-paper";

/** Hairline list: rows separated by 1px rules. */
export const RULED = "flex flex-col divide-y divide-line border-y border-line";

export function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-sm text-dim transition-colors duration-300 hover:text-paper"
    >
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      >
        <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" />
      </svg>
    </button>
  );
}

/** The small "i" that explains a term (relationships are leads, not facts). */
export function InfoTip({ content, label }: { content: string; label: string }) {
  return (
    <Tooltip content={content}>
      <button
        type="button"
        aria-label={label}
        className="flex size-[18px] items-center justify-center rounded-full border border-line-2 font-mono text-[11px] text-dim transition-colors duration-300 hover:border-line-3 hover:text-paper"
      >
        i
      </button>
    </Tooltip>
  );
}

/** Mono key, General Sans value: the label/value pairs in panels. */
export function Field({
  label,
  children,
  mono,
  className,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <dt className="font-mono text-[12px] text-mute">{label}</dt>
      <dd className={cn("text-[14px] text-paper", mono && "font-mono tabular-nums")}>{children}</dd>
    </div>
  );
}

/** "masked": a word and a glyph, not a colour. */
export function MaskedMark() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-xs border border-line-2 px-1.5 py-[3px] font-mono text-[11px] leading-none text-dim">
      <span aria-hidden>••</span>masked
    </span>
  );
}
