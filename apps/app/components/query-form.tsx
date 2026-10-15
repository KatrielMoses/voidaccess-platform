"use client";
import { OutOfCredits } from "@/components/billing/out-of-credits";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ButtonArrow, buttonVariants, cn } from "@voidaccess/ui";
import { DEFAULT_DEPTH, DEPTHS, type Depth } from "@voidaccess/config";
import { DEPTH_COPY, EXAMPLE_QUERIES } from "@/content/examples";
import { QUERY_MAX_LENGTH, QUERY_MIN_LENGTH } from "@/lib/limits";
import { authClient } from "@/lib/auth/client";
import { FormError } from "@/components/field";
import { Notice } from "@/components/page-header";

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
    <form onSubmit={submit} className="flex flex-col gap-8" aria-label="New investigation">
      <div className="flex flex-col gap-4">
        <label htmlFor="query" className="text-[15px] text-dim">
          What do you want to investigate?
        </label>
        {/* The hunt field (design.md §6): a 64px paper block, stone icon, ink 17px input, the violet action inside. */}
        <div className="flex h-16 items-center rounded-lg border border-paper bg-paper pr-[7px] pl-6 transition-[border-color] duration-[350ms] hover:border-paper-2 focus-within:border-v-600 max-[640px]:h-auto max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:gap-2.5 max-[640px]:border-0 max-[640px]:bg-transparent max-[640px]:p-0">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="mr-3.5 size-[17px] flex-none text-stone max-[640px]:hidden"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.6-3.6" />
          </svg>
          <input
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
            className="h-[62px] min-w-0 flex-1 border-0 bg-transparent font-sans text-[17px] text-ink outline-none placeholder:text-stone max-[640px]:h-[58px] max-[640px]:rounded-lg max-[640px]:border max-[640px]:border-paper max-[640px]:bg-paper max-[640px]:px-4 max-[640px]:focus:border-v-600"
          />
          <button
            type="submit"
            disabled={busy || blocked || query.trim().length < QUERY_MIN_LENGTH}
            aria-busy={busy || undefined}
            className={cn(
              buttonVariants({ variant: "primary" }),
              "h-[50px] flex-none px-6 max-[640px]:h-[46px] max-[640px]:w-full",
            )}
          >
            <span className="inline-flex items-center gap-2.5 transition-transform duration-300 ease-out group-active/btn:scale-[.96]">
              {busy ? (
                <span
                  aria-hidden
                  className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
                />
              ) : null}
              Start investigation
              <ButtonArrow />
            </span>
          </button>
        </div>
        {showExamples ? (
          <div className="flex flex-wrap items-center gap-2.5" aria-label="Example queries">
            <span className="mr-1 text-[15px] text-mute">Try</span>
            {EXAMPLE_QUERIES.map((ex) => (
              <button
                key={ex.query}
                type="button"
                onClick={() => setQuery(ex.query)}
                className="inline-flex h-9 items-center rounded-sm border border-line px-3.5 font-mono text-[13px] text-paper transition-[border-color,background-color] duration-300 hover:border-line-2 hover:bg-paper/[.04]"
                title={ex.label}
              >
                {ex.query}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {fixedDepth ? null : (
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-4 text-[15px] text-dim">Depth</legend>
          <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
            {LAUNCHED.map((d) => (
              <label
                key={d}
                className={cn(
                  "flex cursor-pointer items-start gap-3.5 p-5 transition-[background-color] duration-[600ms] ease-out has-[:focus-visible]:outline-[1.5px] has-[:focus-visible]:-outline-offset-4 has-[:focus-visible]:outline-v-200 has-[:focus-visible]:outline-solid",
                  depth === d ? "bg-bg-2" : "bg-bg hover:bg-bg-2/60",
                )}
              >
                <input
                  type="radio"
                  name="depth"
                  value={d}
                  checked={depth === d}
                  onChange={() => setDepth(d)}
                  className="mt-[3px] size-4 flex-none cursor-pointer appearance-none rounded-full border border-line-3 transition-[border-width,border-color] duration-300 checked:border-[5px] checked:border-paper focus-visible:outline-none"
                />
                <span className="flex flex-1 flex-col gap-1.5">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-[17px] font-medium tracking-[-0.01em] text-paper">
                      {DEPTH_COPY[d as keyof typeof DEPTH_COPY].label}
                    </span>
                    <span className="font-mono text-[13px] text-dim tabular-nums">
                      {DEPTHS[d].credits} credits
                    </span>
                  </span>
                  <span className="text-[15px] leading-[1.5] text-dim">
                    {DEPTH_COPY[d as keyof typeof DEPTH_COPY].blurb}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {!emailVerified ? (
        <Notice role="alert" mark="!">
          <p>Confirm your email before you start an investigation. We sent a link to {email}.</p>
          <button
            type="button"
            disabled={resent}
            onClick={async () => {
              await authClient.sendVerificationEmail({ email, callbackURL: "/welcome" });
              setResent(true);
            }}
            className="va-link self-start disabled:no-underline disabled:opacity-70"
          >
            {resent ? "Sent again" : "Send the link again"}
          </button>
        </Notice>
      ) : tooLow ? (
        <Notice role="alert" mark="!">
          <p>
            This needs {price} credits and you have {balance}.{" "}
            <Link href="/billing" className="va-link">
              Top up
            </Link>{" "}
            or{" "}
            <Link href="/billing" className="va-link">
              upgrade your plan
            </Link>
            .
          </p>
        </Notice>
      ) : null}

      <ErrorBlock error={error} />

      <p className="max-w-[64ch] text-[15px] leading-[1.55] text-dim">
        Costs <span className="font-mono text-[13.5px] text-paper tabular-nums">{price}</span> credits. Cancel
        any time and get back the part of the cost for stages that haven&apos;t run. If it fails, you get all
        of it back.
      </p>
    </form>
  );
}

function ErrorBlock({ error }: { error: ApiError | null }) {
  if (!error) return null;
  if (error.error === "insufficient_credits") {
    return <OutOfCredits balance={error.balance ?? 0} needed={error.needed ?? 0} />;
  }
  if (error.error === "unverified_email") {
    return <FormError message="Confirm your email first. Check your inbox for the link." />;
  }
  return <FormError message={error.message ?? "Could not start the investigation."} />;
}
