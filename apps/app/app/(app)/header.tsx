"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CreditPill, cn } from "@voidaccess/ui";
import { authClient } from "@/lib/auth/client";

const NAV = [
  { href: "/investigations/new", label: "New" },
  { href: "/investigations", label: "History" },
];

export function AppHeader({
  initialBalance,
  name,
  email,
  emailVerified,
}: {
  initialBalance: number;
  name: string;
  email: string;
  emailVerified: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [balance, setBalance] = useState(initialBalance);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/account/balance", { cache: "no-store" });
      if (res.ok) setBalance(((await res.json()) as { total: number }).total);
    } catch {
      /* keep the last known balance */
    }
  }, []);

  // Live balance: refetch on navigation, on focus, and every 10 s.
  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);
  useEffect(() => {
    const id = setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("va:balance-changed", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("va:balance-changed", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (name.trim()[0] ?? email[0] ?? "?").toUpperCase();
  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-void/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 sm:h-14 sm:flex-nowrap sm:py-0 sm:px-6">
        <div className="contents sm:flex sm:items-center sm:gap-6">
          <Link
            href="/welcome"
            className="font-display text-lg font-semibold tracking-tight text-fg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            Void<span className="text-accent">Access</span>
          </Link>
          <nav aria-label="Main" className="order-3 flex w-full items-center gap-1 sm:order-none sm:w-auto">
            {NAV.map((n) => {
              const active = n.href === "/investigations" ? pathname === n.href : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent",
                    active ? "bg-raised text-fg" : "text-fg-secondary hover:text-fg",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <CreditPill balance={balance} data-testid="credit-pill" />
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="User menu"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="flex size-8 items-center justify-center rounded-full border border-border-strong bg-raised text-xs font-medium text-fg-secondary hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {initial}
            </button>
            {open ? (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-60 overflow-hidden rounded-md border border-border-subtle bg-overlay shadow-xl shadow-black/40"
              >
                <div className="border-b border-border-dim px-3 py-2.5">
                  <p className="truncate text-sm font-medium text-fg">{name}</p>
                  <p className="truncate text-xs text-fg-secondary">{email}</p>
                  {!emailVerified ? <p className="mt-1 text-xs text-warning">Email not verified</p> : null}
                </div>
                <Link
                  role="menuitem"
                  href="/settings"
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 text-sm text-fg hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
                >
                  Settings
                </Link>
                {[
                  { href: "/billing", label: "Billing" },
                  { href: "/usage", label: "Usage" },
                ].map((m) => (
                  <Link
                    key={m.href}
                    role="menuitem"
                    href={m.href}
                    onClick={() => setOpen(false)}
                    className="block px-3 py-2 text-sm text-fg hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
                  >
                    {m.label}
                  </Link>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    await authClient.signOut();
                    router.push("/sign-in");
                    router.refresh();
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-fg hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
