"use client";

import * as React from "react";
import { Select as S } from "radix-ui";
import { cn } from "../lib/cn";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

export function Select({ options, placeholder, className, id, ...props }: SelectProps) {
  const { "aria-label": ariaLabel, ...root } = props;
  return (
    <S.Root {...root}>
      <S.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface px-3 text-sm text-fg transition-colors hover:border-border-strong focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent-border disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-fg-muted",
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon aria-hidden className="text-fg-muted">
          ▾
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-(--radix-select-trigger-width) overflow-hidden rounded-md border border-border-subtle bg-overlay text-fg shadow-xl shadow-black/40"
        >
          <S.Viewport className="p-1">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex h-9 cursor-pointer items-center rounded px-3 text-sm outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent-dim data-[highlighted]:text-fg data-[state=checked]:text-accent"
              >
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
