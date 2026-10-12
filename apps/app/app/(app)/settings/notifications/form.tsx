"use client";
import { useState } from "react";
import { Badge, Checkbox } from "@voidaccess/ui";

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
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-border-subtle bg-surface p-5">
        <div className="flex items-start gap-3">
          <Checkbox
            id="product-emails"
            data-testid="product-emails"
            checked={on}
            onCheckedChange={(v) => void change(v === true)}
            className="mt-0.5"
          />
          <label htmlFor="product-emails" className="flex flex-col gap-1">
            <span className="font-medium">Product tips and tutorials</span>
            <span className="text-sm text-fg-secondary">
              A short welcome, a nudge if you haven&apos;t tried an investigation yet, and a note on what to
              do with your first results. Occasional product news later on. Every one has an unsubscribe link.
            </span>
          </label>
        </div>
        <p className="mt-3 min-h-5 text-sm" role="status" aria-live="polite">
          {state === "saved" ? <span className="text-success">Saved.</span> : null}
          {state === "saving" ? <span className="text-fg-secondary">Saving…</span> : null}
          {state === "error" ? <span className="text-danger">Could not save. Try again.</span> : null}
        </p>
      </section>
      <section className="rounded-lg border border-border-subtle bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">Usage alerts, receipts and account email</h2>
          <Badge variant="accent">Always on</Badge>
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          Credit usage alerts, results-ready messages, payment receipts and security emails are part of
          running your account, so they can&apos;t be switched off.
        </p>
      </section>
    </div>
  );
}
