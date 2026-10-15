"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, NativeSelect, Textarea } from "@voidaccess/ui";

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
  destructive = false,
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
  /** Destructive actions (suspend, ban, remove) get the outline button; their wording says what happens. */
  destructive?: boolean;
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
      className="group/af rounded-lg border border-line transition-[border-color,background-color] duration-300 open:border-line-2 open:bg-bg-2 hover:border-line-2"
      data-testid={`${testId}-details`}
    >
      <summary className="flex h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-[15px] text-paper select-none [&::-webkit-details-marker]:hidden">
        {title}
        <span
          aria-hidden
          className="font-mono text-[13px] text-mute transition-transform duration-300 ease-out group-open/af:rotate-45"
        >
          +
        </span>
      </summary>
      <form onSubmit={onSubmit} data-testid={testId} className="flex flex-col gap-4 border-t border-line p-4">
        {fields.map((f) => (
          <div key={f.name} className="flex flex-col gap-2">
            <label htmlFor={`${id}-${f.name}`} className="text-[15px] text-dim">
              {f.label}
            </label>
            {f.type === "select" ? (
              <NativeSelect id={`${id}-${f.name}`} name={f.name} required defaultValue={f.defaultValue}>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
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
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-reason`} className="text-[15px] text-dim">
            Reason (required, kept in the audit log)
          </label>
          <Textarea
            id={`${id}-reason`}
            name="reason"
            required
            minLength={8}
            maxLength={1000}
            rows={2}
            className="min-h-20"
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
        {state.kind === "ok" ? (
          <p role="status" className="text-[15px] text-paper" data-testid={`${testId}-ok`}>
            <span aria-hidden className="font-mono text-[12px]">
              ✓{" "}
            </span>
            {state.text}
          </p>
        ) : null}
        <Button
          type="submit"
          variant={destructive ? "secondary" : "paper"}
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
