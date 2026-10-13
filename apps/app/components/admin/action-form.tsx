"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@voidaccess/ui";

export interface ActionField {
  name: string;
  label: string;
  type?: "text" | "number" | "select";
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  min?: number;
  max?: number;
  defaultValue?: string;
}

/**
 * One admin action: optional fields plus a REQUIRED typed reason (the server enforces the same rule and writes the audit row).
 * Posts JSON to `endpoint`, shows the server's error or a success note, then refreshes the page's server data.
 */
export function ActionForm({
  endpoint,
  method = "POST",
  title,
  submit,
  fields = [],
  hidden = {},
  danger = false,
  testId,
  open = false,
  success = "Done.",
}: {
  endpoint: string;
  method?: "POST" | "DELETE";
  title: string;
  submit: string;
  fields?: ActionField[];
  hidden?: Record<string, unknown>;
  danger?: boolean;
  testId: string;
  open?: boolean;
  success?: string;
}) {
  const router = useRouter();
  const id = useId();
  // one id per mounted form: a double click re-sends the same requestId, which the server treats as a no-op
  const [requestId] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<{ kind: "idle" | "busy" | "ok" | "error"; text?: string }>({
    kind: "idle",
  });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { ...hidden, requestId, reason: String(fd.get("reason") ?? "") };
    for (const f of fields) {
      const v = String(fd.get(f.name) ?? "");
      body[f.name] = f.type === "number" ? Number(v) : v;
    }
    setState({ kind: "busy" });
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setState({ kind: "ok", text: success });
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setState({ kind: "error", text: err instanceof Error ? err.message : "Request failed" });
    }
  }

  return (
    <details
      open={open || undefined}
      className="rounded-lg border border-border-subtle bg-surface"
      data-testid={`${testId}-details`}
    >
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium select-none">{title}</summary>
      <form
        onSubmit={onSubmit}
        data-testid={testId}
        className="flex flex-col gap-3 border-t border-border-dim px-4 py-3"
      >
        {fields.map((f) => (
          <div key={f.name} className="flex flex-col gap-1">
            <label htmlFor={`${id}-${f.name}`} className="text-xs font-medium text-fg-secondary">
              {f.label}
            </label>
            {f.type === "select" ? (
              <select
                id={`${id}-${f.name}`}
                name={f.name}
                required
                defaultValue={f.defaultValue}
                className="h-10 rounded-md border border-border-subtle bg-surface px-2 text-sm text-fg"
              >
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={`${id}-${f.name}`}
                name={f.name}
                type={f.type ?? "text"}
                required
                min={f.min}
                max={f.max}
                placeholder={f.placeholder}
                defaultValue={f.defaultValue}
              />
            )}
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-reason`} className="text-xs font-medium text-fg-secondary">
            Reason (required, kept in the audit log)
          </label>
          <textarea
            id={`${id}-reason`}
            name="reason"
            required
            minLength={8}
            maxLength={1000}
            rows={2}
            className="rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm text-fg"
          />
        </div>
        {state.kind === "error" ? (
          <p role="alert" className="text-sm text-danger" data-testid={`${testId}-error`}>
            {state.text}
          </p>
        ) : null}
        {state.kind === "ok" ? (
          <p role="status" className="text-sm text-success" data-testid={`${testId}-ok`}>
            {state.text}
          </p>
        ) : null}
        <Button
          type="submit"
          variant={danger ? "danger" : "primary"}
          size="sm"
          loading={state.kind === "busy"}
          className="self-start"
        >
          {submit}
        </Button>
      </form>
    </details>
  );
}
