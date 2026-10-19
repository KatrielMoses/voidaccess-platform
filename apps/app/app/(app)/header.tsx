"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CreditPill, cn } from "@voidaccess/ui";
import { authClient } from "@/lib/auth/client";
import { SIGN_IN_URL } from "@/lib/site";
import { Logo } from "@/components/logo";

const NAV = [
  { href: "/investigations/new", label: "Investigate" },
  { href: "/investigations", label: "History" },
];

const MENU = [
  { href: "/settings", label: "Settings" },
  { href: "/billing", label: "Billing" },
  { href: "/usage", label: "Usage" },
];

const item =
  "flex h-10 w-full items-center px-4 text-left text-[15px] text-dim transition-colors duration-300 hover:bg-paper/[.04] hover:text-paper focus-visible:bg-paper/[.04] focus-visible:text-paper";

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
    <header className="sticky top-0 z-30 border-b border-line bg-bg/[.78] backdrop-blur-[18px] backdrop-saturate-[1.4]">
      <div className="va-wrap flex h-[68px] items-center gap-11 max-[960px]:h-auto max-[960px]:flex-wrap max-[960px]:gap-0">
        <Logo href="/welcome" className="max-[960px]:h-[60px]" />
        <nav
          aria-label="Main"
          className="flex items-center gap-[30px] max-[960px]:order-last max-[960px]:h-11 max-[960px]:w-full max-[960px]:border-t max-[960px]:border-line"
        >
          {NAV.map((n) => {
            const active = n.href === "/investigations" ? pathname === n.href : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className="ul-link text-[15px] leading-none"
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 max-[960px]:h-[60px]">
          {/* the balance links to Billing: that's where you top up or change plan */}
          <Link
            href="/billing"
            aria-label={`${balance.toLocaleString("en-US")} credits. Top up or change plan`}
            className="rounded-md focus-visible:outline-[1.5px] focus-visible:outline-v-200"
          >
            <CreditPill balance={balance} data-testid="credit-pill" />
          </Link>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="User menu"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className={cn(
                "flex size-9 items-center justify-center rounded-full border text-[14px] font-medium transition-[border-color,color] duration-300",
                open
                  ? "border-paper text-paper"
                  : "border-line-2 text-dim hover:border-paper hover:text-paper",
              )}
            >
              {initial}
            </button>
            {open ? (
              <div
                role="menu"
                className="absolute right-0 mt-2.5 w-64 overflow-hidden rounded-lg border border-line-2 bg-bg-2 py-1.5 animate-[va-menu-in_.45s_cubic-bezier(.16,1,.3,1)]"
              >
                <div className="mb-1.5 border-b border-line px-4 pt-2 pb-3">
                  <p className="truncate text-[15px] font-medium text-paper">{name}</p>
                  <p className="truncate font-mono text-[12px] text-mute">{email}</p>
                  {!emailVerified ? (
                    <p className="mt-2 font-mono text-[12px] text-dim">! Email not verified</p>
                  ) : null}
                </div>
                {MENU.map((m) => (
                  <Link
                    key={m.href}
                    role="menuitem"
                    href={m.href}
                    onClick={() => setOpen(false)}
                    aria-current={pathname.startsWith(m.href) ? "page" : undefined}
                    className={cn(item, "aria-[current=page]:text-paper")}
                  >
                    {m.label}
                  </Link>
                ))}
                <div className="my-1.5 h-px bg-line" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    await authClient.signOut();
                    window.location.assign(SIGN_IN_URL);
                    router.refresh();
                  }}
                  className={item}
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
