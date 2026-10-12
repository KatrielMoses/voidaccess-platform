"use client";
import { useState } from "react";
import { Checkbox } from "@voidaccess/ui";

export function AupCheckbox({ aupUrl }: { aupUrl: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id="aup"
        name="aup"
        required
        checked={on}
        onCheckedChange={(v) => setOn(v === true)}
        className="mt-0.5"
      />
      <label htmlFor="aup" className="text-sm text-fg-secondary">
        I have read and accept the{" "}
        <a
          href={aupUrl}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline underline-offset-2"
        >
          Acceptable Use Policy
        </a>
        .
      </label>
    </div>
  );
}
