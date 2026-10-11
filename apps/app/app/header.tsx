import Link from "next/link";
import { CreditPill } from "@voidaccess/ui";

// Placeholder: static balance until auth + ledger are wired up.
const PLACEHOLDER_BALANCE = 0;

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-void/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="font-display text-lg font-semibold tracking-tight text-fg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          Void<span className="text-accent">Access</span>
        </Link>
        <div className="flex items-center gap-4">
          <CreditPill balance={PLACEHOLDER_BALANCE} />
          <button
            type="button"
            aria-label="User menu (placeholder)"
            className="flex size-8 items-center justify-center rounded-full border border-border-strong bg-raised text-xs font-medium text-fg-secondary hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ?
          </button>
        </div>
      </div>
    </header>
  );
}
