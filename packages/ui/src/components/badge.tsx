import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-border-subtle bg-raised text-fg-secondary",
        accent: "border-accent-border bg-accent-dim text-accent",
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/10 text-warning",
        danger: "border-danger/30 bg-danger/10 text-danger",
        neutral: "border-border-subtle bg-neutral/10 text-fg-secondary",
        actor: "border-entity-actor/30 bg-entity-actor/10 text-entity-actor",
        wallet: "border-entity-wallet/30 bg-entity-wallet/10 text-entity-wallet",
        malware: "border-entity-malware/30 bg-entity-malware/10 text-entity-malware",
        forum: "border-entity-forum/30 bg-entity-forum/10 text-entity-forum",
        cve: "border-entity-cve/30 bg-entity-cve/10 text-entity-cve",
        paste: "border-entity-paste/30 bg-entity-paste/10 text-entity-paste",
        onion: "border-entity-onion/30 bg-entity-onion/10 text-entity-onion",
        email: "border-entity-email/30 bg-entity-email/10 text-entity-email",
        pgp: "border-entity-pgp/30 bg-entity-pgp/10 text-entity-pgp",
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
  "accent",
  "success",
  "warning",
  "danger",
  "neutral",
] as const satisfies readonly BadgeVariant[];

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
