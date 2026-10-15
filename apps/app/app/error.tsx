"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@voidaccess/ui";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="va-wrap flex min-h-[70vh] flex-col pt-[clamp(56px,14vh,160px)] pb-24">
      <div className="va-rise flex max-w-[640px] flex-col gap-6">
        <p className="flex items-center gap-3 font-mono text-[13px] text-dim">
          <i aria-hidden className="inline-block h-px w-7 bg-line-3" />
          Error
        </p>
        <h1 className="text-[clamp(40px,4.8vw,70px)] leading-none font-medium tracking-[-0.04em]">
          Something went wrong on our side.
        </h1>
        <p className="text-[17px] leading-[1.55] text-dim">
          Try again. If it keeps happening, quote the reference below when you contact us.
        </p>
        {error.digest ? (
          <p className="inline-flex h-9 items-center self-start rounded-sm border border-line px-3.5 font-mono text-[13px] text-paper">
            {error.digest}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2.5">
          <Button size="lg" variant="secondary" onClick={reset}>
            Try again
          </Button>
          <Link href="/investigations" className={buttonVariants({ variant: "ghost", size: "lg" })}>
            Go to your investigations
          </Link>
        </div>
      </div>
    </main>
  );
}
