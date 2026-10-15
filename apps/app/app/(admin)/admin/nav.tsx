"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/abuse", label: "Abuse" },
  { href: "/admin/costs", label: "Costs" },
  { href: "/admin/archive", label: "Archive" },
  { href: "/admin/founding", label: "Founding" },
  { href: "/admin/blocked-domains", label: "Blocked domains" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Admin"
      className="flex flex-wrap items-center gap-x-[26px] gap-y-3 max-[960px]:order-last max-[960px]:w-full max-[960px]:border-t max-[960px]:border-line max-[960px]:py-3.5"
    >
      {NAV.map((n) => {
        const active = n.href === "/admin" ? pathname === n.href : pathname.startsWith(n.href);
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
  );
}
