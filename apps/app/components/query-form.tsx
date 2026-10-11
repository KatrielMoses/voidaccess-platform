"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, cn } from "@voidaccess/ui";
import { DEFAULT_DEPTH, DEPTHS, type Depth } from "@voidaccess/config";
import { DEPTH_COPY, EXAMPLE_QUERIES } from "@/content/examples";
import { QUERY_MAX_LENGTH, QUERY_MIN_LENGTH } from "@/lib/limits";
import { authClient } from "@/lib/auth/client";
import { FormError } from "@/components/field";

const LAUNCHED = (Object.keys(DEPTHS) as Depth[]).filter((d) => DEPTHS[d].launched);

interface ApiError {
  error?: string;
  message?: string;
  balance?: number;
  needed?: number;
}

export function QueryForm({
  balance,
  emailVerified,
  email,
  defaultQuery = "",
  fixedDepth,
  showExamples = false,
  autoFocus = false,
}: {
  balance: number;
  emailVerified: boolean;
  email: string;
  defaultQuery?: string;
  /** When set, no selector is shown and this depth is used (first-run screen). */
  fixedDepth?: Depth;
  showExamples?: boolean;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultQuery);
  const [depth, setDepth] = useState<Depth>(
    fixedDepth ?? (DEPTHS[DEFAULT_DEPTH].launched ? DEFAULT_DEPTH : LAUNCHED[0]!),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [resent, setResent] = useState(false);

  const price = DEPTHS[depth].credits;
  const tooLow = balance < price;
  const blocked = !emailVerified || tooLow;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/investigations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, depth }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiError & { id?: string };
      if (!res.ok || !body.id) {
        setError(body.error ? body : { message: "Something went wrong. Try again." });
        return;
      }
      window.dispatchEvent(new Event("va:balance-changed"));
      router.push(`/investigations/${body.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" aria-label="New investigation">
      <div className="flex flex-col gap-2">
        <label htmlFor="query" className="text-sm font-medium text-fg">
          What do you want to investigate?
        </label>
        <Input
          id="query"
          name="query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="A threat actor, malware family, CVE, brand or domain"
          minLength={QUERY_MIN_LENGTH}
          maxLength={QUERY_MAX_LENGTH}
          required
          autoFocus={autoFocus}
          autoComplete="off"
          className="h-12 text-base"
        />
        {showExamples ? (
          <div className="flex flex-wrap items-center gap-2" aria-label="Example queries">
            <span className="text-xs text-fg-muted">Try:</span>
            {EXAMPLE_QUERIES.map((ex) => (
              <button
                key={ex.query}
                type="button"
                onClick={() => setQuery(ex.query)}
                className="rounded-full border border-border-subtle bg-raised px-3 py-1 text-xs text-fg-secondary transition-colors hover:border-accent-border hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
                title={ex.label}
              >
                {ex.query}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {fixedDepth ? null : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-fg">Depth</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {LAUNCHED.map((d) => (
              <label
                key={d}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border bg-surface p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
                  depth === d
                    ? "border-accent bg-accent-dim"
                    : "border-border-subtle hover:border-border-strong",
                )}
              >
                <input
                  type="radio"
                  name="depth"
                  value={d}
                  checked={depth === d}
                  onChange={() => setDepth(d)}
                  className="mt-1 accent-[#9b9fee]"
                />
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-fg">
                      {DEPTH_COPY[d as keyof typeof DEPTH_COPY].label}
                    </span>
                    <span className="font-mono text-sm text-accent tabular-nums">
                      {DEPTHS[d].credits} credits
                    </span>
                  </span>
                  <span className="text-sm text-fg-secondary">
                    {DEPTH_COPY[d as keyof typeof DEPTH_COPY].blurb}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {!emailVerified ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning"
        >
          <p>Confirm your email before you start an investigation. We sent a link to {email}.</p>
          <button
            type="button"
            disabled={resent}
            onClick={async () => {
              await authClient.sendVerificationEmail({ email, callbackURL: "/welcome" });
              setResent(true);
            }}
            className="self-start underline underline-offset-2 disabled:no-underline disabled:opacity-70"
          >
            {resent ? "Sent again" : "Send the link again"}
          </button>
        </div>
      ) : tooLow ? (
        <div
          role="alert"
          className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning"
        >
          This needs {price} credits and you have {balance}.{" "}
          <Link href="/billing" className="underline underline-offset-2">
            Top up
          </Link>{" "}
          or{" "}
          <Link href="/billing" className="underline underline-offset-2">
            upgrade your plan
          </Link>
          .
        </div>
      ) : null}

      <ErrorBlock error={error} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-fg-secondary">
          Costs <span className="font-mono text-fg tabular-nums">{price}</span> credits. Cancel any time and
          get back the part of the cost for stages that haven&apos;t run. If it fails, you get all of it back.
        </p>
        <Button
          type="submit"
          size="lg"
          loading={busy}
          disabled={blocked || query.trim().length < QUERY_MIN_LENGTH}
        >
          Start investigation
        </Button>
      </div>
    </form>
  );
}

function ErrorBlock({ error }: { error: ApiError | null }) {
  if (!error) return null;
  if (error.error === "insufficient_credits") {
    return (
      <p
        role="alert"
        className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
      >
        {error.message}{" "}
        <Link href="/billing" className="underline underline-offset-2">
          Top up or upgrade
        </Link>
        .
      </p>
    );
  }
  if (error.error === "unverified_email") {
    return <FormError message="Confirm your email first. Check your inbox for the link." />;
  }
  return <FormError message={error.message ?? "Could not start the investigation."} />;
}
