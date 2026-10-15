import * as React from "react";
import { Input, cn } from "@voidaccess/ui";
import { Notice } from "./page-header";

/** Label + input pair with an accessible error/hint link. */
export function Field({
  label,
  id,
  hint,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-[15px] font-medium text-paper">
        {label}
      </label>
      <Input id={id} name={id} aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint ? (
        <p id={`${id}-hint`} className="text-[15px] text-mute">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <Notice role="alert" mark="✕">
      <p>{message}</p>
    </Notice>
  );
}

export function FormNotice({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <Notice role="status" mark="✓" tone="quiet">
      <p className="text-paper">{message}</p>
    </Notice>
  );
}
