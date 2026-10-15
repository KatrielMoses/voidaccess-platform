import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

/**
 * A mono label on a hairline (design.md §4: mono for labels and values). There is no hue: state is carried by the word,
 * the weight of the line and, for genuinely live state only, a v-500 marker.
 *
 * - default: dim label, `line` border
 * - strong: paper label, `line-2` border (current plan, always-on)
 * - outline: paper label, `line-3` border (failed, needs attention: "boxed")
 * - quiet: mute label, no border (cancelled, coming soon)
 * - live: paper label with a v-500 marker (running). The one violet thing in its view.
 */
const plain = "border-line text-dim";
export const badgeVariants = cva(
  "inline-flex h-6 items-center gap-1.5 rounded-xs border px-2 font-mono text-[12px] leading-none font-normal whitespace-nowrap",
  {
    variants: {
      variant: {
        default: plain,
        strong: "border-line-2 text-paper",
        outline: "border-line-3 text-paper",
        quiet: "border-transparent px-0 text-mute",
        live: "border-line-2 text-paper before:size-1.5 before:rounded-full before:bg-v-500 before:content-['']",
        // Legacy names, kept so existing callers compile. They map onto the hue-free styles above.
        accent: "border-line-2 text-paper",
        success: "border-line-2 text-paper",
        warning: "border-line-2 text-dim",
        danger: "border-line-3 text-paper",
        neutral: "border-transparent px-0 text-mute",
        actor: plain,
        wallet: plain,
        malware: plain,
        forum: plain,
        cve: plain,
        paste: plain,
        onion: plain,
        email: plain,
        pgp: plain,
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;
export const ENTITY_BADGE_VARIANTS = [
  "actor",
  "wallet",
  "malware",
  "forum",
  "cve",
  "paste",
  "onion",
  "email",
  "pgp",
] as const satisfies readonly BadgeVariant[];
export const STATUS_BADGE_VARIANTS = [
  "default",
  "strong",
  "outline",
  "quiet",
  "live",
] as const satisfies readonly BadgeVariant[];

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
