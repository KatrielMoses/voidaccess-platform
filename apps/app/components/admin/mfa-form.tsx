"use client";
import { useId, useState } from "react";
import { Button, Input } from "@voidaccess/ui";

const MESSAGES: Record<string, string> = {
  invalid_code: "That code didn't work. Enter the current 6-digit code from your authenticator.",
  too_many_attempts: "Too many attempts. Wait 10 minutes, then try again.",
  enrolment_expired: "This setup expired. Reload the page to get a new code to scan.",
};

/** The 6-digit authenticator code: confirms the enrolment or unlocks the console for an hour. */
export function MfaForm({ next, submit, testId }: { next: string; submit: string; testId: string }) {
  const id = useId();
  const [state, setState] = useState<{ kind: "idle" | "busy" | "error"; text?: string }>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s+/g, "");
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/admin/mfa/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(MESSAGES[json.error ?? ""] ?? `Request failed (${res.status})`);
      // a full navigation, so every server component renders again with the new cookie
      window.location.assign(next);
    } catch (err) {
      setState({ kind: "error", text: err instanceof Error ? err.message : "Request failed" });
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-[360px] flex-col gap-4" data-testid={testId}>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-code`} className="text-[15px] text-dim">
          6-digit code
        </label>
        <Input
          id={`${id}-code`}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\s*(\d\s*){6}"
          maxLength={8}
          required
          autoFocus
          className="font-mono text-[18px] tracking-[0.3em]"
        />
      </div>
      {state.kind === "error" ? (
        <p role="alert" className="text-[15px] text-paper" data-testid={`${testId}-error`}>
          <span aria-hidden className="font-mono text-[12px]">
            ✕{" "}
          </span>
          {state.text}
        </p>
      ) : null}
      <Button type="submit" variant="paper" size="sm" loading={state.kind === "busy"} className="self-start">
        {submit}
      </Button>
    </form>
  );
}

/** "Lock now": clears the step-up cookie, then reloads so the code screen appears. */
export function LockButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="ul-link text-[15px] whitespace-nowrap"
      disabled={busy}
      data-testid="admin-lock"
      onClick={async () => {
        setBusy(true);
        await fetch("/api/admin/mfa/lock", { method: "POST" }).catch(() => null);
        window.location.reload();
      }}
    >
      Lock now
    </button>
  );
}
