"use client";
import { useState } from "react";
import { Badge, Checkbox } from "@voidaccess/ui";
import { Row } from "@/components/page-header";

export function NotificationForm({ productEmails }: { productEmails: boolean }) {
  const [on, setOn] = useState(productEmails);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function change(next: boolean) {
    const prev = on;
    setOn(next);
    setState("saving");
    try {
      const res = await fetch("/api/account/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productEmails: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("saved");
    } catch {
      setOn(prev);
      setState("error");
    }
  }

  return (
    <>
      <Row title="Product email" note="Optional, and off with one click.">
        <div className="flex items-start gap-3.5">
          <Checkbox
            id="product-emails"
            data-testid="product-emails"
            checked={on}
            onCheckedChange={(v) => void change(v === true)}
            className="mt-[3px]"
          />
          <label htmlFor="product-emails" className="flex cursor-pointer flex-col gap-1.5">
            <span className="text-[15px] font-medium text-paper">Product tips and tutorials</span>
            <span className="max-w-[60ch] text-[15px] leading-[1.55] text-dim">
              A short welcome, a nudge if you haven&apos;t tried an investigation yet, and a note on what to
              do with your first results. Occasional product news later on. Every one has an unsubscribe link.
            </span>
          </label>
        </div>
        <p className="min-h-5 pl-8 font-mono text-[12.5px]" role="status" aria-live="polite">
          {state === "saved" ? (
            <span className="text-paper">
              <span aria-hidden>✓ </span>Saved.
            </span>
          ) : null}
          {state === "saving" ? <span className="text-dim">Saving…</span> : null}
          {state === "error" ? (
            <span className="text-paper">
              <span aria-hidden>✕ </span>Could not save. Try again.
            </span>
          ) : null}
        </p>
      </Row>
      <Row
        title="Usage alerts, receipts and account email"
        note="Credit usage alerts, results-ready messages, payment receipts and security emails are part of running your account, so they can't be switched off."
      >
        <Badge variant="strong" className="self-start">
          Always on
        </Badge>
      </Row>
    </>
  );
}
