import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

/**
 * design.md §6 Buttons. Primary = the one violet action in a view (v-600, hover v-700). Secondary = outline (paper at .5,
 * full paper + 4% fill on hover). Paper = the top-nav action. Destructive actions use the outline style with explicit
 * wording: there is no red in the system. The label scales to .96 while pressed.
 */
export const buttonVariants = cva(
  "group/btn relative inline-flex items-center justify-center gap-2.5 rounded-sm border font-sans font-medium whitespace-nowrap select-none transition-[background-color,border-color,color] duration-300 ease-out disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "border-transparent bg-v-600 text-paper hover:bg-v-700",
        secondary: "border-paper/50 text-paper hover:border-paper hover:bg-paper/[.04]",
        paper: "border-transparent bg-paper text-ink hover:bg-white",
        ghost: "border-transparent text-dim hover:bg-paper/[.04] hover:text-paper",
        /** @deprecated destructive actions are outline buttons with explicit wording; kept as an alias of `secondary`. */
        danger: "border-paper/50 text-paper hover:border-paper hover:bg-paper/[.04]",
      },
      size: {
        sm: "h-9 rounded-xs px-3.5 text-[15px] leading-none",
        md: "h-[42px] px-[22px] text-[15px] leading-none",
        lg: "h-[46px] px-[22px] text-[15px] leading-none max-[960px]:h-[42px] max-[960px]:px-[18px]",
        icon: "size-10 text-[15px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  loading = false,
  disabled,
  children,
  type = "button",
  ref,
  ...props
}: ButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      <span className="inline-flex items-center gap-2.5 transition-transform duration-300 ease-out group-active/btn:scale-[.96]">
        {loading ? (
          <span
            aria-hidden
            className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
          />
        ) : null}
        {children}
      </span>
    </button>
  );
}

/** The design's sliding arrow ("→" out to the right, a second one in from the left on hover). Use inside a Button. */
export function ButtonArrow({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block size-3.5 overflow-hidden leading-[14px]",
        "before:absolute before:inset-0 before:transition-transform before:duration-[550ms] before:ease-out before:content-['→']",
        "after:absolute after:inset-0 after:-translate-x-[120%] after:transition-transform after:duration-[550ms] after:ease-out after:content-['→']",
        "group-hover/btn:before:translate-x-[120%] group-hover/btn:after:translate-x-0",
        className,
      )}
    />
  );
}
