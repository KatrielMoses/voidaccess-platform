"use client";

import * as React from "react";
import { Select as S } from "radix-ui";
import { cn } from "../lib/cn";
import { inputClass } from "./input";

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
          inputClass,
          "inline-flex h-[46px] items-center justify-between gap-2 text-left data-[placeholder]:text-stone",
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon aria-hidden className="text-stone">
          <svg viewBox="0 0 12 12" className="size-3">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={6}
          className="z-50 min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border border-line bg-bg-2 text-paper"
        >
          <S.Viewport className="p-1">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex h-10 cursor-pointer items-center justify-between gap-3 rounded-xs px-3 text-[15px] text-dim outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-paper/[.06] data-[highlighted]:text-paper data-[state=checked]:text-paper"
              >
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className="font-mono text-[12px] text-dim">✓</S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
