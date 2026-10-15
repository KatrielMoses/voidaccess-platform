"use client";
import { useState } from "react";
import { Checkbox } from "@voidaccess/ui";

export function AupCheckbox({ aupUrl }: { aupUrl: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className="flex items-start gap-3.5">
      <Checkbox
        id="aup"
        name="aup"
        required
        checked={on}
        onCheckedChange={(v) => setOn(v === true)}
        className="mt-[3px]"
      />
      <label htmlFor="aup" className="cursor-pointer text-[15px] leading-[1.55] text-dim">
        I have read and accept the{" "}
        <a href={aupUrl} target="_blank" rel="noreferrer" className="va-link">
          Acceptable Use Policy
        </a>
        .
      </label>
    </div>
  );
}
